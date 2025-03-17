const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const {getConfig} = require("./middleware/configManager");

function startAdminConsole(config) {
  // Initialize Express app
  const app = express();

  // Middleware
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: "account-admin-secret",
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false }, // set to true if using https
    }),
  );

  // Serve static files
  app.use(express.static(path.join(__dirname, "public")));

  // Config file initialization
  const configPath = path.join(__dirname, "config.js");
  if (!fs.existsSync(configPath)) {
    const initialConfig = {
      accounts: [],
    };
    fs.writeFileSync(
      configPath,
      `module.exports = ${JSON.stringify(initialConfig, null, 2)};`,
      "utf8",
    );
  }

  // Routes
  const authMiddleware = require("./middleware/auth");
  const accountRoutes = require("./routes/accounts");

  // Authentication routes
  app.get("/", (req, res) => {
    if (req.session.authenticated) {
      res.redirect("/accounts");
    } else {
      res.sendFile(path.join(__dirname, "views", "login.html"));
    }
  });

  app.post("/login", (req, res) => {
    const { password } = req.body;
    const config = getConfig();

    if (password === config.adminConsole.adminPassword) {
      req.session.authenticated = true;
      res.redirect("/accounts");
    } else {
      res.redirect("/?error=1");
    }
  });

  app.get("/logout", (req, res) => {
    req.session.authenticated = false;
    res.redirect("/");
  });

  // Protected routes
  app.use("/accounts", authMiddleware, accountRoutes);

  // Start server
  let port = config.adminConsole.port || 31322;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = { startAdminConsole };
