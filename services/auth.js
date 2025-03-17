const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const {v4: uuidv4} = require('uuid');

const internalAuthenticationToken = uuidv4();

function getInternalAuthenticationToken() {
    return internalAuthenticationToken;
}

// Initialize database
const dbPath = path.join(__dirname, 'auth.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening auth database:', err.message);
    } else {
        console.log('Connected to the auth database.');

        // Create tokens table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS tokens
                (
                    token
                    TEXT
                    PRIMARY
                    KEY,
                    created_at
                    INTEGER
                    NOT
                    NULL
                )`, (err) => {
            if (err) {
                console.error('Error creating tokens table:', err.message);
            } else {
                console.log('Tokens table ready');
            }
        });

        // Create conversation_access table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS conversation_access
        (
            token
            TEXT
            NOT
            NULL,
            conversation_id
            TEXT
            NOT
            NULL,
            access_type
            TEXT
            NOT
            NULL,
            created_at
            INTEGER
            NOT
            NULL,
            PRIMARY
            KEY
                (
            token,
            conversation_id
                ),
            FOREIGN KEY
                (
                    token
                ) REFERENCES tokens
                (
                    token
                ) ON DELETE CASCADE
            )`, (err) => {
            if (err) {
                console.error('Error creating conversation_access table:', err.message);
            } else {
                console.log('Conversation access table ready');
            }
        });

        // Create gizmo_access table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS gizmo_access
        (
            token
            TEXT
            NOT
            NULL,
            gizmo_id
            TEXT
            NOT
            NULL,
            access_type
            TEXT
            NOT
            NULL,
            created_at
            INTEGER
            NOT
            NULL,
            PRIMARY
            KEY
                (
            token,
            gizmo_id
                ),
            FOREIGN KEY
                (
                    token
                ) REFERENCES tokens
                (
                    token
                ) ON DELETE CASCADE
            )`, (err) => {
            if (err) {
                console.error('Error creating gizmo_access table:', err.message);
            } else {
                console.log('Gizmo access table ready');
            }
        });
    }
});

// Generate a secure random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Save a token to the database
function saveToken(token) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('INSERT INTO tokens (token, created_at) VALUES (?, ?)');
        stmt.run(token, Date.now(), function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
        stmt.finalize();
    });
}

// Verify if a token exists in the database
function verifyToken(token) {
    return new Promise((resolve, reject) => {
        if (!token) {
            resolve(false);
            return;
        }

        db.get('SELECT token FROM tokens WHERE token = ?', [token], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

// Conversation Access Functions
function checkConversationAccess(conversationId, token, requiredAccessType = null) {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_CONVERSATION_ISOLATION) {
        return true;
    }
    return new Promise((resolve, reject) => {
        if (!token || !conversationId) {
            resolve(false);
            return;
        }

        // Build the query based on whether we need to check for a specific access type
        let query = 'SELECT access_type FROM conversation_access WHERE token = ? AND conversation_id = ?';
        const params = [token, conversationId];

        if (requiredAccessType) {
            query += ' AND access_type = ?';
            params.push(requiredAccessType);
        }

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

function addConversationAccess(conversationId, token, accessType = 'owner') {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_CONVERSATION_ISOLATION) {
        return true;
    }
    return new Promise((resolve, reject) => {
        // First, check if the conversation_id already exists with a different token
        const checkStmt = db.prepare(
            'SELECT token FROM conversation_access WHERE conversation_id = ?'
        );

        checkStmt.get(conversationId, (err, row) => {
            if (err) {
                reject(err);
            } else if (row && row.token !== token) {
                // If a different token is associated with the conversation_id, throw an error
                reject(
                    new Error(
                        'Access to this conversation cannot be granted. A different user already has access.'
                    )
                );
            } else {
                // If no conflicting token, insert or replace access record
                const stmt = db.prepare(
                    'INSERT OR REPLACE INTO conversation_access (token, conversation_id, access_type, created_at) VALUES (?, ?, ?, ?)'
                );

                stmt.run(token, conversationId, accessType, Date.now(), function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });

                stmt.finalize();
            }
        });

        checkStmt.finalize();
    });
}

function listUserConversations(token) {
    return new Promise((resolve, reject) => {
        if (!token) {
            resolve([]);
            return;
        }

        db.all(
            'SELECT conversation_id, access_type FROM conversation_access WHERE token = ? ORDER BY created_at DESC',
            [token],
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            }
        );
    });
}

function removeConversationAccess(conversationId, token) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('DELETE FROM conversation_access WHERE token = ? AND conversation_id = ?');

        stmt.run(token, conversationId, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes > 0);
            }
        });

        stmt.finalize();
    });
}

// Gizmo Access Functions
function checkGizmoAccess(gizmoId, token, requiredAccessType = null) {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_GIZMO_ISOLATION) {
        return true;
    }
    return new Promise((resolve, reject) => {
        if (!token || !gizmoId) {
            resolve(false);
            return;
        }

        // Build the query based on whether we need to check for a specific access type
        let query = 'SELECT access_type FROM gizmo_access WHERE token = ? AND gizmo_id = ?';
        const params = [token, gizmoId];

        if (requiredAccessType) {
            query += ' AND access_type = ?';
            params.push(requiredAccessType);
        }

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

function addGizmoAccess(gizmoId, token, accessType = 'owner') {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_GIZMO_ISOLATION) {
        return true;
    }
    return new Promise((resolve, reject) => {
        // First, check if the gizmo_id already exists with a different token and owner access
        const checkStmt = db.prepare(
            'SELECT token FROM gizmo_access WHERE gizmo_id = ? AND access_type = "owner"'
        );

        checkStmt.get(gizmoId, (err, row) => {
            if (err) {
                reject(err);
            } else if (row && row.token !== token && accessType === 'owner') {
                // If a different token is associated with the gizmo_id as owner, throw an error
                reject(
                    new Error(
                        'Ownership of this gizmo cannot be granted. A different user already owns it.'
                    )
                );
            } else {
                // If no conflicting token, insert or replace access record
                const stmt = db.prepare(
                    'INSERT OR REPLACE INTO gizmo_access (token, gizmo_id, access_type, created_at) VALUES (?, ?, ?, ?)'
                );

                stmt.run(token, gizmoId, accessType, Date.now(), function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });

                stmt.finalize();
            }
        });

        checkStmt.finalize();
    });
}

function listUserGizmos(token) {
    return new Promise((resolve, reject) => {
        if (!token) {
            resolve([]);
            return;
        }

        db.all(
            'SELECT gizmo_id, access_type FROM gizmo_access WHERE token = ? ORDER BY created_at DESC',
            [token],
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            }
        );
    });
}

function removeGizmoAccess(gizmoId, token) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare('DELETE FROM gizmo_access WHERE token = ? AND gizmo_id = ?');

        stmt.run(token, gizmoId, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes > 0);
            }
        });

        stmt.finalize();
    });
}


module.exports = {
    generateToken,
    saveToken,
    verifyToken,

    // Conversation access functions
    checkConversationAccess,
    addConversationAccess,
    listUserConversations,
    removeConversationAccess,

    // Gizmo access functions
    checkGizmoAccess,
    addGizmoAccess,
    listUserGizmos,
    removeGizmoAccess,

    getInternalAuthenticationToken
};