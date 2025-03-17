const express = require('express');
const fetch = require('node-fetch');
const app = express();

const PROMETHEUS_BASE_URL = 'http://prometheus:9090';

/**
 * Helper: Build the URL for a Prometheus range query
 */
function buildRangeQueryURL(metric, start, end, step) {
  return `${PROMETHEUS_BASE_URL}/api/v1/query_range?query=${encodeURIComponent(metric)}&start=${start}&end=${end}&step=${step}`;
}

/**
 * Helper: Convert a JavaScript Date to a UNIX timestamp (in seconds).
 */
function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Process the Prometheus query_range result and group values into
 * a nested object: plan -> instance -> accountName -> [ { timestamp, value }, ... ]
 */
function processPrometheusData(result) {
  // The final structure we want to build:
  //
  // {
  //   [plan]: {
  //     [instance]: {
  //       [accountName]: Array<{ timestamp, value }>
  //     }
  //   }
  // }
  //
  const nestedData = {};

  if (!result || !Array.isArray(result)) {
    return nestedData;
  }

  for (const series of result) {
    // Extract relevant labels from the metric
    const plan = series.metric.plan || 'unknown_plan';
    const instance = series.metric.instance || 'unknown_instance';
    const accountName = series.metric.account_name || 'unknown_account';

    // Initialize objects if they don't exist
    if (!nestedData[plan]) {
      nestedData[plan] = {};
    }
    if (!nestedData[plan][instance]) {
      nestedData[plan][instance] = {};
    }
    if (!nestedData[plan][instance][accountName]) {
      nestedData[plan][instance][accountName] = [];
    }

    // Push time series data
    for (const [timestamp, value] of series.values) {
      nestedData[plan][instance][accountName].push({
        timestamp: parseFloat(timestamp),
        value: parseFloat(value)
      });
    }

    // Sort each account's data by ascending timestamp
    nestedData[plan][instance][accountName].sort((a, b) => a.timestamp - b.timestamp);
  }

  return nestedData;
}

/*******************************************************
 * 1. SERVER ROUTE: returns processed JSON to the client
 *******************************************************/
app.get('/api/data', async (req, res) => {
  try {
    // Time range: last 8 days
    const end = toUnixSeconds(new Date());
    const start = end - (8 * 24 * 60 * 60);  // 8 days ago
    const step = '30m';

    // Query Prometheus for the degradation metric aggregated over 30 minute intervals.
    const degradationUrl = buildRangeQueryURL('max_over_time(chatgpt_degradation[30m])', start, end, step);
    const degradationResp = await fetch(degradationUrl);
    const degradationJson = await degradationResp.json();
    const degradationResult = degradationJson.data?.result || [];
    const degradationData = processPrometheusData(degradationResult);

    // Query Prometheus for the knowledge cutoff date (multiplied by 1000)
    const cutoffUrl = buildRangeQueryURL('min_over_time(chatgpt_knowledge_cutoff_date[30m]) * 1000', start, end, step);
    const cutoffResp = await fetch(cutoffUrl);
    const cutoffJson = await cutoffResp.json();
    const cutoffResult = cutoffJson.data?.result || [];
    const cutoffData = processPrometheusData(cutoffResult);

    // Send the processed data as JSON
    res.json({
      startTime: start,
      endTime: end,
      degradationData,
      cutoffData
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error retrieving data from Prometheus.' });
  }
});

/*******************************************************
 * 2. CLIENT ROUTE: returns HTML + JS for rendering
 *******************************************************/
app.get('/', (req, res) => {
  // Inline client HTML/JS. The JS fetches /api/data and renders the timeline in the browser.
  const clientHTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <title>ChatGPT Degradation Monitor</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      :root {
        --green: #00c875;
        --yellow: #ffcb47;
        --red: #ff5c5c;
        --gray: #d8dee4;
        --light-gray: #f8f9fa;
        --dark-gray: #343a40;
        --text-color: #262730;
        --border-color: #e9ecef;
        --accent-color: #0d6efd;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
          Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        background: var(--light-gray);
        color: var(--text-color);
        line-height: 1.6;
      }
      
      header {
        background: #fff;
        padding: 2rem 0;
        border-bottom: 1px solid var(--border-color);
      }
      
      .navbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 2rem;
      }
      
      .logo {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text-color);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      
      .container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 0 2rem;
      }
      
      .status-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
      }
      
      .status-title {
        font-size: 1.75rem;
        font-weight: 700;
      }
      
      .status-date {
        font-size: 0.875rem;
        color: #6c757d;
      }
      
      .instances-container {
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        padding: 1rem;
      }
      
      /* Hierarchy styling */
      .plan-block, .instance-block, .account-block {
        margin-bottom: 2rem;
        border-left: 2px solid var(--border-color);
        padding-left: 1rem;
      }
      .plan-block h2, .instance-block h3, .account-block h4 {
        margin-bottom: 1rem;
      }
      
      /* Instance styling from original code */
      .instance-row {
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 1rem;
        margin-bottom: 1rem;
      }
      
      .instance-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .instance-name {
        font-size: 1rem;
        font-weight: 600;
      }
      
      .instance-status {
        font-size: 0.875rem;
        font-weight: 500;
        padding: 0.25rem 0.75rem;
        border-radius: 50px;
      }
      
      .status-operational {
        color: var(--green);
        background: rgba(0, 200, 117, 0.1);
      }
      
      .slightly-slightly-degraded {
        color: var(--yellow);
        background: rgba(255, 203, 71, 0.1);
      }
      
      .slightly-severely-degraded {
        color: var(--red);
        background: rgba(255, 92, 92, 0.1);
      }
      
      .status-unknown {
        color: #6c757d;
        background: rgba(108, 117, 125, 0.1);
      }
      
      /* Timeline grid styles */
      .timeline-grid {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      
      .day-row {
        display: flex;
        gap: 2px;
      }
      
      .tick {
        flex: 1;
        height: 20px;
        border-radius: 4px;
        cursor: pointer;
        position: relative;
        transition: all 0.2s ease;
      }
      
      .tick:hover {
        transform: translateY(-2px);
      }
      
      .tick.green {
        background-color: var(--green);
      }
      
      .tick.yellow {
        background-color: var(--yellow);
      }
      
      .tick.red {
        background-color: var(--red);
      }
      
      .tick.gray {
        background-color: var(--gray);
      }
      
      .tooltip {
        position: absolute;
        bottom: 135%;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(33, 37, 41, 0.95);
        color: #fff;
        padding: 0.75rem 1rem;
        border-radius: 6px;
        font-size: 0.75rem;
        line-height: 1.5;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease-in-out;
        z-index: 1000;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        min-width: 200px;
        text-align: center;
      }
      
      .tooltip-time {
        font-weight: 600;
        margin-bottom: 0.25rem;
        display: block;
      }
      
      .tooltip-info {
        font-weight: 400;
        display: block;
      }
      
      .tick:hover .tooltip {
        opacity: 1;
      }
      
      .tooltip::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -5px;
        border-width: 5px;
        border-style: solid;
        border-color: rgba(33, 37, 41, 0.95) transparent transparent transparent;
      }
      
      footer {
        text-align: center;
        padding: 2rem 0;
        color: #6c757d;
        font-size: 0.875rem;
        border-top: 1px solid var(--border-color);
        margin-top: 3rem;
      }
      
      @media (max-width: 768px) {
        .navbar, .container {
          padding: 0 1rem;
        }
        
        .status-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="navbar">
        <div class="logo">
          ChatGPT Degradation Monitor
        </div>
      </div>
    </header>
    
    <div class="container">
      <div class="status-header">
        <h1 class="status-title">System Status</h1>
        <div id="currentDate" class="status-date"></div>
      </div>
      
      <div class="instances-container" id="root">
        <!-- The timeline will be rendered here by JavaScript -->
      </div>
    </div>
    
    <footer>
      <p>ChatGPT Degradation Monitor</p>
      <p id="lastUpdated"></p>
    </footer>

    <!-- CLIENT-SIDE SCRIPT -->
    <script>
      /**
       * Helper: Format a UNIX timestamp (in seconds) to the local browser time zone string
       */
      function formatDate(tsSeconds) {
        const d = new Date(tsSeconds * 1000);
        return d.toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }

      /**
       * Get status text based on degradation value
       */
      function getStatusText(value) {
        if (value === 0) return "Operational";
        if (value === 1) return "Slightly Degraded";
        if (value >= 2) return "Severely Degraded";
        return "Unknown";
      }

      /**
       * Helper: Get the metric value for a given tick time from the aggregated data.
       */
      function getValueForTick(dataPoints, tickTime, lookbackSeconds) {
        // Since dataPoints are aggregated per tick with step=30m, look for the point that is within the tick window.
        for (let i = 0; i < dataPoints.length; i++) {
          const dp = dataPoints[i];
          if (dp.timestamp >= tickTime - lookbackSeconds && dp.timestamp <= tickTime) {
            return dp.value;
          }
        }
        return null;
      }

      /**
       * Build the timeline (48 half-hour blocks x 8 days) for a given array of data points (degradation or cutoff).
       * Returns a DIV element with .timeline-grid inside.
       */
      function buildTimeline(dataPoints, cutoffPoints, startTime) {
        const timelineGrid = document.createElement('div');
        timelineGrid.className = 'timeline-grid';
        
        const days = 8;
        const intervalsPerDay = 48; // 30-minute intervals
        const daySeconds = 24 * 60 * 60;
        const halfHourSeconds = 30 * 60;

        for (let d = 0; d < days; d++) {
          const dayRow = document.createElement('div');
          dayRow.className = 'day-row';

          for (let i = 0; i < intervalsPerDay; i++) {
            const tickTime = startTime + (d * daySeconds) + (i * halfHourSeconds);
            const degradeValue = getValueForTick(dataPoints, tickTime, halfHourSeconds);
            const cutoffValue = getValueForTick(cutoffPoints, tickTime, halfHourSeconds);

            let colorClass = 'gray';
            let statusText = 'No Data';
            if (degradeValue !== null && !isNaN(degradeValue)) {
              if (degradeValue === 0) {
                colorClass = 'green';
                statusText = 'Operational';
              } else if (degradeValue === 1) {
                colorClass = 'yellow';
                statusText = 'Slightly Degraded';
              } else if (degradeValue >= 2) {
                colorClass = 'red';
                statusText = 'Severely Degraded';
              }
            }

            let cutoffInfo = 'No data available';
            if (cutoffValue !== null && !isNaN(cutoffValue)) {
              const cutoffDate = new Date(cutoffValue);
              cutoffInfo = \`Knowledge cutoff: \${cutoffDate.toISOString().split('T')[0]}\`;
            }

            // Create the tick element
            const tickDiv = document.createElement('div');
            tickDiv.className = \`tick \${colorClass}\`;

            // Tooltip
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';

            const tooltipTime = document.createElement('span');
            tooltipTime.className = 'tooltip-time';
            tooltipTime.textContent = formatDate(tickTime);

            const tooltipStatus = document.createElement('span');
            tooltipStatus.className = 'tooltip-info';
            tooltipStatus.innerHTML = \`<strong>Status:</strong> \${statusText}\`;

            const tooltipCutoff = document.createElement('span');
            tooltipCutoff.className = 'tooltip-info';
            tooltipCutoff.innerHTML = \`<strong>\${cutoffInfo}</strong>\`;

            tooltip.appendChild(tooltipTime);
            tooltip.appendChild(tooltipStatus);
            tooltip.appendChild(tooltipCutoff);

            tickDiv.appendChild(tooltip);
            dayRow.appendChild(tickDiv);
          }

          timelineGrid.appendChild(dayRow);
        }

        return timelineGrid;
      }

      /**
       * Render the nested data into #root
       * The structure is plan -> instance -> accountName
       */
      function renderData(degradationData, cutoffData, startTime) {
        const root = document.getElementById('root');
        root.innerHTML = ''; // Clear existing content

        // For each plan
        Object.keys(degradationData).forEach(plan => {
          // Create a container for the plan
          const planBlock = document.createElement('div');
          planBlock.className = 'plan-block';

          const planTitle = document.createElement('h2');
          planTitle.textContent = \`Plan: \${plan}\`;
          planBlock.appendChild(planTitle);

          // For each instance under that plan
          Object.keys(degradationData[plan]).forEach(instance => {
            const instanceBlock = document.createElement('div');
            instanceBlock.className = 'instance-block';

            const instanceTitle = document.createElement('h3');
            instanceTitle.textContent = \`Scrape Target: \${instance}\`;
            instanceBlock.appendChild(instanceTitle);

            // For each account under that instance
            Object.keys(degradationData[plan][instance]).forEach(accountName => {
              const accountBlock = document.createElement('div');
              accountBlock.className = 'account-block';

              const accountHeader = document.createElement('div');
              accountHeader.className = 'instance-header';  // Reuse styling
              
              const accountTitle = document.createElement('h4');
              accountTitle.className = 'instance-name';
              accountTitle.textContent = \`Account: \${accountName}\`;

              // We'll compute the "final" degrade value for this account’s data
              const degradePoints = degradationData[plan][instance][accountName];
              const finalValue = degradePoints?.length
                ? degradePoints[degradePoints.length - 1].value
                : null;

              let currentStatus = 'No Data';
              let statusClass = 'status-unknown';
              if (finalValue !== null && !isNaN(finalValue)) {
                currentStatus = getStatusText(finalValue);
                if (finalValue === 0) {
                  statusClass = 'status-operational';
                } else if (finalValue === 1) {
                  statusClass = 'slightly-slightly-degraded';
                } else if (finalValue >= 2) {
                  statusClass = 'slightly-severely-degraded';
                }
              }

              const accountStatus = document.createElement('div');
              accountStatus.className = \`instance-status \${statusClass}\`;
              accountStatus.textContent = currentStatus;

              accountHeader.appendChild(accountTitle);
              accountHeader.appendChild(accountStatus);

              // Build the timeline
              const cutoffPoints = cutoffData[plan]?.[instance]?.[accountName] || [];
              const timeline = buildTimeline(degradePoints, cutoffPoints, startTime);

              // Put it all together in the account block
              accountBlock.appendChild(accountHeader);
              accountBlock.appendChild(timeline);

              // Append account block into the instance block
              instanceBlock.appendChild(accountBlock);
            });

            // Append instance block into the plan block
            planBlock.appendChild(instanceBlock);
          });

          // Finally, append this plan block into root
          root.appendChild(planBlock);
        });
      }

      // Update the date labels in the header/footer
      const now = new Date();
      document.getElementById('currentDate').textContent = now.toLocaleDateString([], {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      document.getElementById('lastUpdated').textContent = 'Last updated: ' + now.toLocaleString();

      // Fetch data from our server
      fetch('/api/data')
        .then(res => res.json())
        .then(data => {
          const { degradationData, cutoffData, startTime } = data;
          renderData(degradationData, cutoffData, startTime);
        })
        .catch(err => {
          console.error('Error fetching data:', err);
        });
    </script>
  </body>
  </html>
  `;

  res.send(clientHTML);
});

/*******************************************************
 * Start the server
 *******************************************************/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ChatGPT Degradation Monitor running at http://localhost:${PORT}`);
});
