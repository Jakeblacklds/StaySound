import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (db) return db;

    db = await SQLite.openDatabaseAsync('staysound.db');

    // Initialize tables
    await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            photo_url TEXT,
            biography TEXT,
            timestamp INTEGER NOT NULL
        );
    `);

    return db;
}

/**
 * Clear the database (mostly for development)
 */
export async function clearDatabase() {
    const database = await getDatabase();
    await database.execAsync('DROP TABLE IF EXISTS artists;');
    db = null;
    await getDatabase(); // Re-initialize
}
