# ISS Lightstreamer Data Server

A Node.js Express server that connects to the International Space Station (ISS) live data stream using Lightstreamer and stores the data in a SQLite database.

## Features

- Connects to the ISS Live data stream via Lightstreamer
- Automatically parses available data items from PUIList.xml
- Stores data in a SQLite database (limited to 100 data points per key by default)
- Provides RESTful API endpoints to access the stored data

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd iss-lightstreamer-server

# Install dependencies
pnpm install
```

## Usage

```bash
# Start the server
node server.js
```

The server will run on port 3000 by default. You can change this by setting the PORT environment variable.

## API Endpoints

### Get all data points
```
GET /api/data
```
Returns all data points stored in the database, ordered by key and timestamp (descending).

### Get all data points for a specific key
```
GET /api/data/:key
```
Returns all data points for the specified key, ordered by timestamp (descending).

### Get the latest data point for each key
```
GET /api/latest
```
Returns the most recent data point for each key.

### Get a list of all available keys
```
GET /api/keys
```
Returns a list of all unique keys in the database.

## How It Works

1. The server connects to the Lightstreamer service at `https://push.lightstreamer.com` with the `ISSLIVE` adapter.
2. It attempts to parse the `PUIList.xml` file to identify available data items.
3. The server subscribes to the available data items and receives real-time updates.
4. Data is stored in a SQLite database, with a limit of 100 data points per key.
5. The RESTful API allows you to retrieve the stored data.

## Database Schema

The server uses a simple SQLite database with a single table:

```sql
CREATE TABLE stream_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT,
  timestamp INTEGER,
  UNIQUE(key, timestamp)
);
```

## Dependencies

- Express: Web server framework
- SQLite3: Database for storing the data
- Lightstreamer-client-node: Client for connecting to Lightstreamer
- XML2JS: For parsing the PUIList.xml file
- Body-parser: Middleware for parsing request bodies

## License

ISC 