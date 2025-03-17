/**
 * Accounts.js - Client-side JavaScript for account management
 */

// DOM Elements
const accountsTableBody = document.getElementById("accountsTableBody");
const noAccountsMessage = document.getElementById("noAccountsMessage");
const accountForm = document.getElementById("accountForm");
const saveAccountBtn = document.getElementById("saveAccountBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
const cookieAutofillBtn = document.getElementById("cookieAutofillBtn");

// Bootstrap instances
const accountModal = new bootstrap.Modal(
  document.getElementById("accountModal"),
);
const deleteModal = new bootstrap.Modal(
  document.getElementById("deleteAccountModal"),
);

// Load all accounts
async function loadAccounts() {
  try {
    const response = await fetch("/accounts/api/list");
    const accounts = await response.json();

    // Clear the table
    accountsTableBody.innerHTML = "";

    if (accounts.length === 0) {
      noAccountsMessage.classList.remove("d-none");
    } else {
      noAccountsMessage.classList.add("d-none");

      // Populate the table
      accounts.forEach((account) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${account.name}</td>
<td>${account.proxy || "-"}</td>
<td>${account.labels?.plan || ""}</td>
<td class="account-actions">
    <p>
        <button class="btn btn-sm btn-primary" onclick="openAccountModal('edit', '${account.name}')">
            <i class="bi bi-pencil"></i> Edit
        </button>
        <button class="btn btn-sm btn-danger" onclick="openDeleteModal('${account.name}')">
            <i class="bi bi-trash"></i> Delete
        </button>
    </p>

    <p>
        <button class="btn btn-sm btn-info" onclick="restartAccountBrowser('${account.name}')">
            <i class="bi bi-arrow-clockwise"></i> Restart Browser
        </button>
        <button class="btn btn-sm btn-warning" onclick="deleteAccountBrowser('${account.name}')">
            <i class="bi bi-incognito"></i> Delete Browser
        </button>

    </p>
</td>
                `;
        accountsTableBody.appendChild(row);
      });
    }
  } catch (error) {
    console.error("Error loading accounts:", error);
    showNotification("Error", "Failed to load accounts", "danger");
  }
}

// Open Account Modal (Add or Edit)
async function openAccountModal(mode, accountName = null) {
  // Reset the form
  accountForm.reset();

  // Set mode
  document.getElementById("modalMode").value = mode;

  if (mode === "add") {
    // Configure for add mode
    document.getElementById("accountModalTitle").textContent =
      "Add New Account";
    if (localStorage["lastSavedAccountProxy"]) {
      document.getElementById("accountProxy").value =
        localStorage["lastSavedAccountProxy"];
    }
    saveAccountBtn.textContent = "Save";
    cookieAutofillBtn.classList.remove("d-none");
  } else {
    // Configure for edit mode
    document.getElementById("accountModalTitle").textContent = "Edit Account";
    saveAccountBtn.textContent = "Update";
    cookieAutofillBtn.classList.remove("d-none");

    try {
      // Fetch account data
      const response = await fetch(`/accounts/api/${accountName}`);
      const account = await response.json();

      // Populate the form
      document.getElementById("originalAccountName").value = accountName;
      document.getElementById("accountName").value = account.name;
      document.getElementById("accountProxy").value = account.proxy || "";
      document.getElementById("accountAccessToken").value =
        account.accessToken || "";
      document.getElementById("accountCookies").value = account.cookie || "";
      document.getElementById("accountPlan").value =
        account.labels?.plan || "plus";
    } catch (error) {
      console.error("Error loading account details:", error);
      showNotification("Error", "Failed to load account details", "danger");
      return;
    }
  }

  // Show the modal
  accountModal.show();
}

// Save or Update Account
async function saveAccount() {
  const mode = document.getElementById("modalMode").value;

  // Collect form data
  const formData = new FormData(accountForm);
  const accountData = {
    name: formData.get("accountName"),
    proxy: formData.get("accountProxy"),
    accessToken: formData.get("accountAccessToken"),
    cookie: formData.get("accountCookies"),
    labels: {
      plan: formData.get("accountPlan"),
    },
  };

  try {
    let response;

    if (mode === "add") {
      // Add new account
      localStorage["lastSavedAccountProxy"] =
        document.getElementById("accountProxy").value;
      response = await fetch("/accounts/api/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(accountData),
      });
    } else {
      // Update existing account
      const originalName = formData.get("originalAccountName");
      response = await fetch(`/accounts/api/${originalName}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(accountData),
      });
    }

    const result = await response.json();

    if (response.ok) {
      // Close the modal
      accountModal.hide();

      // Reload accounts and show success message
      loadAccounts();
      showNotification("Success", result.message);
    } else {
      showNotification("Error", result.message, "danger");
    }
  } catch (error) {
    console.error(
      `Error ${mode === "add" ? "adding" : "updating"} account:`,
      error,
    );
    showNotification(
      "Error",
      `Failed to ${mode === "add" ? "add" : "update"} account`,
      "danger",
    );
  }
}

// Open delete confirmation modal
function openDeleteModal(name) {
  document.getElementById("deleteAccountName").textContent = name;
  confirmDeleteBtn.dataset.name = name;
  deleteModal.show();
}

function showNotification(
  title,
  message,
  type = "info",
  { delay = 5000, key = null } = {},
) {
  // 1. container (once)
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container position-fixed top-0 end-0 p-3";
    document.body.appendChild(container);
  }

  // 2. locate or build toast
  let toastEl = key
    ? container.querySelector(`[data-toast-key="${key}"]`)
    : null;

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast align-items-center border-0";
    toastEl.setAttribute("role", "alert");
    toastEl.setAttribute("aria-live", "assertive");
    toastEl.setAttribute("aria-atomic", "true");
    toastEl.id = crypto.randomUUID?.() ?? `toast-${Date.now()}`;
    if (key) toastEl.dataset.toastKey = key;

    /* --- header --- */
    const header = document.createElement("div");
    header.className = `toast-header bg-${type} text-white border-0`;

    const strong = document.createElement("strong");
    strong.className = "me-auto";
    strong.textContent = title;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-close btn-close-white";
    closeBtn.setAttribute("data-bs-dismiss", "toast");
    closeBtn.setAttribute("aria-label", "Close");

    header.append(strong, closeBtn);

    /* --- body --- */
    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = message;

    toastEl.append(header, body);
    container.appendChild(toastEl);

    // clean up on hide
    toastEl.addEventListener("hidden.bs.toast", () => {
      toastEl.remove();
      if (!container.querySelector(".toast")) container.remove();
    });
  } else {
    // 3. update existing keyed toast
    toastEl.querySelector(".toast-header strong").textContent = title;
    toastEl.querySelector(".toast-header").className =
      `toast-header bg-${type} text-white border-0`;
    toastEl.querySelector(".toast-body").textContent = message;
  }

  // 4. show / restart
  new bootstrap.Toast(toastEl, { autohide: delay !== 0, delay }).show();
}

// Delete an account
async function deleteAccount() {
  const name = confirmDeleteBtn.dataset.name;

  try {
    const response = await fetch(`/accounts/api/${name}`, {
      method: "DELETE",
    });

    const result = await response.json();

    if (response.ok) {
      // Close the modal
      deleteModal.hide();

      // Reload accounts and show success message
      loadAccounts();
      showNotification("Success", result.message);
    } else {
      showNotification("Error", result.message, "danger");
    }
  } catch (error) {
    console.error("Error deleting account:", error);
    showNotification("Error", "Failed to delete account", "danger");
  }
}

// Auto-fill fields using cookies
async function autofillFromCookies() {
  const cookies = document.getElementById("accountCookies").value;

  if (!cookies || cookies.trim() === "") {
    showNotification("Warning", "Please enter cookies first", "warning");
    return;
  }

  // Check if proxy is provided
  const proxy = document.getElementById("accountProxy").value;
  if (!proxy || proxy.trim() === "") {
    showNotification(
      "Warning",
      "Proxy is required for extracting data",
      "warning",
    );
    return;
  }

  try {
    showNotification("Info", "Extracting data from cookies...", "info");

    // Call the API to extract data from cookies
    const extractedData = await extractDataFromCookies(cookies);

    if (extractedData) {
      // Fill the form fields with extracted data
      if (extractedData.name) {
        document.getElementById("accountName").value = extractedData.name;
      }

      if (extractedData.accessToken) {
        document.getElementById("accountAccessToken").value =
          extractedData.accessToken;
      }

      // Set the plan if available
      if (extractedData.plan) {
        document.getElementById("accountPlan").value = extractedData.plan;
      }

      showNotification(
        "Success",
        "Fields auto-filled from ChatGPT account data",
      );
    } else {
      showNotification(
        "Warning",
        "Could not extract data from cookies",
        "warning",
      );
    }
  } catch (error) {
    console.error("Error parsing cookies:", error);
    showNotification("Error", "Failed to parse cookies", "danger");
  }
}

// Function to extract data from cookies via API
async function extractDataFromCookies(cookieString) {
  if (!cookieString || cookieString.trim() === "") {
    return null;
  }

  // Get the proxy from the form
  const proxy = document.getElementById("accountProxy").value;
  if (!proxy || proxy.trim() === "") {
    showNotification(
      "Warning",
      "Proxy is required for extracting data from cookies",
      "warning",
    );
    return null;
  }

  try {
    const response = await fetch("/accounts/api/extract-cookies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cookies: cookieString,
        proxy: proxy,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.message || "Failed to extract data from cookies",
      );
    }

    return await response.json();
  } catch (error) {
    console.error("Error extracting data from cookies:", error);
    showNotification(
      "Error",
      error.message || "Failed to extract data from cookies",
      "danger",
    );
    return null;
  }
}

async function deleteAccountBrowser(accountName) {
  if (
    !confirm(`Are you sure you want to delete the browser for ${accountName}?`)
  ) {
    return false;
  }
  try {
    const response = await fetch(
      `/accounts/api/delete-browser/${accountName}`,
      {
        method: "POST",
      },
    );

    const result = await response.json();

    if (response.ok) {
      showNotification("Success", result.message);
    } else {
      showNotification("Error", result.message, "danger");
    }
  } catch (error) {
    console.error("Error deleting browser:", error);
    showNotification("Error", "Failed to delete browser", "danger");
  }
}

// Restart browser for an account
async function restartAccountBrowser(accountName) {
  if (
    !confirm(`Are you sure you want to restart the browser for ${accountName}?`)
  ) {
    return false;
  }
  try {
    const response = await fetch(
      `/accounts/api/restart-browser/${accountName}`,
      {
        method: "POST",
      },
    );

    const result = await response.json();

    if (response.ok) {
      showNotification("Success", result.message);
    } else {
      showNotification("Error", result.message, "danger");
    }
  } catch (error) {
    console.error("Error restarting browser:", error);
    showNotification("Error", "Failed to restart browser", "danger");
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Load accounts when the page loads
  loadAccounts();

  // Save account button click
  saveAccountBtn.addEventListener("click", saveAccount);

  // Delete account confirmation
  confirmDeleteBtn.addEventListener("click", deleteAccount);

  // Cookie auto-fill button click
  cookieAutofillBtn.addEventListener("click", autofillFromCookies);
});
