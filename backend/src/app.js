require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

// Import Keycloak and database setup
const { keycloak, memoryStore } = require("./config/keycloak-config");
const sequelize = require("./config/database-config");

// Import Models (to ensure they are registered with Sequelize)
require("./models/User");
require("./models/Voucher");

const app = express();

// Middleware
app.use(cors()); // Configure CORS properly for production
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup (required for Keycloak)
// const memoryStore = new session.MemoryStore(); // Use the one from keycloak-config
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: true,
  store: memoryStore // Use imported memoryStore
}));

// Initialize Keycloak middleware
app.use(keycloak.middleware({
  logout: "/logout", // Specify Keycloak logout path
  admin: "/", // Specify admin path if needed
}));

// Basic route for testing
app.get('/api/health', (req, res) => {
  res.json({ status: 'UP' });
});

// Import and use routes
const authRoutes = require("./routes/authRoutes"); // Added auth routes
const userRoutes = require("./routes/userRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
// Note: Keycloak protection is applied within the route files themselves
app.use("/api/auth", authRoutes); // Added auth routes usage
app.use("/api/users", userRoutes);
app.use("/api/membership", membershipRoutes);

// Serve frontend static files (if building together)
// app.use(express.static(path.join(__dirname, '../../frontend/dist')));
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../../frontend/dist', 'index.html'));
// });

const PORT = process.env.PORT || 3001;

// Sync database and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Unable to connect to the database:", err);
});

// Temporary start without DB sync for now
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

module.exports = app; // Export for potential testing

