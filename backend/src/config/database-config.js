const { Sequelize } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const databasePath = process.env.DATABASE_PATH || "database/database.sqlite";
const absoluteDatabasePath = path.resolve(__dirname, "../../", databasePath);

console.log(`Attempting to connect to SQLite database at: ${absoluteDatabasePath}`);

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: absoluteDatabasePath,
  logging: console.log, // Enable logging to see SQL queries
});

async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log("Database connection has been established successfully.");
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
}

testConnection();

module.exports = sequelize;

