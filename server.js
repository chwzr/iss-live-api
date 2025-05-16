const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { LightstreamerClient, Subscription } = require('lightstreamer-client-node');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database setup
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database');
    createTables();
  }
});

function createTables() {
  return new Promise((resolve, reject) => {
    // Create a table to store the streaming data
    db.run(`
      CREATE TABLE IF NOT EXISTS stream_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT,
        timestamp INTEGER,
        description TEXT,
        ops_nom TEXT,
        eng_nom TEXT,
        units TEXT,
        min_value TEXT,
        max_value TEXT,
        enum_values TEXT,
        format_spec TEXT,
        UNIQUE(key, timestamp)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating stream_data table:', err);
        reject(err);
        return;
      }
      
      // Create an index on the key column for faster lookups
      db.run(`CREATE INDEX IF NOT EXISTS idx_key ON stream_data (key)`, (err) => {
        if (err) {
          console.error('Error creating index:', err);
          reject(err);
          return;
        }
        console.log('Database tables created successfully');
        resolve();
      });
    });
  });
}

// Lightstreamer client setup
const lsClient = new LightstreamerClient("https://push.lightstreamer.com", "ISSLIVE");

// Function to extract items from PUIList.xml
async function getItemsFromPUIList() {
  try {
    // var timeSub = new ls.Subscription('MERGE', 'TIME_000001', ['TimeStamp','Value','Status.Class','Status.Indicator']);
    // Default items to subscribe to if we can't parse the XML
    const defaultItems = ["STATUS_ORIGIN", "NODE_2_POWER", "NODE_3_POWER", 
                         "ISS_ATTITUDE_ROLL", "ISS_ATTITUDE_PITCH", "ISS_ATTITUDE_YAW",
                         "TIME_TO_SUNRISE", "TIME_TO_SUNSET", "AIRLOCK000001",
                         "AIRLOCK000002", "NODE_2_SOLAR_BETA"];

    // Check if PUIList.xml exists
    if (!fs.existsSync(path.join(__dirname, 'PUIList.xml'))) {
      console.log('PUIList.xml not found, using default items');
      return {items: defaultItems, metadata: {}};
    }

    // Try to parse the XML file
    try {
      // Install xml2js if it doesn't exist
      require('xml2js');
    } catch (e) {
      console.log('xml2js not installed, using default items');
      return {items: defaultItems, metadata: {}};
    }

    const xmlData = fs.readFileSync(path.join(__dirname, 'PUIList.xml'), 'utf16le');
    const result = await parseStringPromise(xmlData);
    
    // Extract all Public_PUI values and their metadata
    const items = [];
    const metadata = {};
    
    // Navigate through the XML structure to find all Public_PUI elements
    if (result.ISSLivePUIList && result.ISSLivePUIList.Discipline) {
      result.ISSLivePUIList.Discipline.forEach(discipline => {
        if (discipline.Symbol) {
          discipline.Symbol.forEach(symbol => {
            if (symbol.Public_PUI && symbol.Public_PUI.length > 0) {
              const key = symbol.Public_PUI[0];
              items.push(key);
              
              // Store metadata for this item
              metadata[key] = {
                description: symbol.Description && symbol.Description.length > 0 ? symbol.Description[0] : '',
                ops_nom: symbol.OPS_NOM && symbol.OPS_NOM.length > 0 ? symbol.OPS_NOM[0] : '',
                eng_nom: symbol.ENG_NOM && symbol.ENG_NOM.length > 0 ? symbol.ENG_NOM[0] : '',
                units: symbol.UNITS && symbol.UNITS.length > 0 ? symbol.UNITS[0] : '',
                min_value: symbol.MIN && symbol.MIN.length > 0 ? symbol.MIN[0] : '',
                max_value: symbol.MAX && symbol.MAX.length > 0 ? symbol.MAX[0] : '',
                enum_values: symbol.ENUM && symbol.ENUM.length > 0 ? symbol.ENUM[0] : '',
                format_spec: symbol.Format_Spec && symbol.Format_Spec.length > 0 ? symbol.Format_Spec[0] : ''
              };
            }
          });
        }
      });
    }
    
    // If we couldn't find any items, return the default ones
    if (items.length === 0) {
      console.log('No items found in XML, using default items');
      return {items: defaultItems, metadata: {}};
    }

    return {items, metadata};
    
  } catch (error) {
    console.error('Error parsing PUIList.xml:', error);
    return {
      items: ["STATUS_ORIGIN", "NODE_2_POWER", "NODE_3_POWER", 
             "ISS_ATTITUDE_ROLL", "ISS_ATTITUDE_PITCH", "ISS_ATTITUDE_YAW"],
      metadata: {}
    };
  }
}

// Function to connect to Lightstreamer
async function connectToLightstreamer() {
  console.log('Connecting to Lightstreamer...');
  
  lsClient.addListener({
    onStatusChange: (status) => {
      console.log(`Lightstreamer connection status: ${status}`);
    }
  });
  
  lsClient.connect();
  
  // Get items to subscribe to
  const {items: itemsToSubscribe, metadata} = await getItemsFromPUIList();
  
  // Create a subscription with the items
  const subscription = new Subscription("MERGE", itemsToSubscribe, ["Value"]);
  
  subscription.addListener({
    onSubscription: () => {
      console.log(`Subscribed to ${itemsToSubscribe.length} items`);
    },
    onUnsubscription: () => {
      console.log('Unsubscribed from items');
    },
    onItemUpdate: (updateInfo) => {
      const key = updateInfo.getItemName();
      const value = updateInfo.getValue("Value");
      const timestamp = Date.now();
      
      console.log(`Received update for ${key}: ${value}`);
      
      // Get the metadata for this item
      const itemMetadata = metadata[key] || {
        description: '',
        ops_nom: '',
        eng_nom: '',
        units: '',
        min_value: '',
        max_value: '',
        enum_values: '',
        format_spec: ''
      };
      
      // Store the data in the database
      storeData(key, value, timestamp, itemMetadata);
    }
  });
  
  lsClient.subscribe(subscription);

//   timeSub.addListener({
//     onItemUpdate: function (update) {
//       var status = update.getValue('Status.Class');
//       AOStimestamp = parseFloat(update.getValue('TimeStamp'));
//       difference = timestampnow - AOStimestamp;
          
//       if (status === '24') 
//       {
//             if(difference > 0.00153680542553047)
//             {
//            console.log("Stale Signal!")
//            AOS = "Stale Signal";
//            AOSnum = 2;
//             }
//             else
//             {
//            console.log("Signal Acquired!")
//            AOS = "Siqnal Acquired";
//            AOSnum = 1;
//             }
//       }
//       else 
//       {
//         console.log("Signal Lost!")
//         AOS = "Signal Lost";
//         AOSnum = 0;
//       }
//     }
//   });
}

// Function to store data in the database
function storeData(key, value, timestamp, metadata) {
  // First check if the table exists
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='stream_data'`, (err, row) => {
    if (err) {
      console.error('Error checking for table:', err);
      return;
    }
    
    if (!row) {
      console.error('Table stream_data does not exist, recreating...');
      createTables().then(() => {
        insertData(key, value, timestamp, metadata);
      }).catch(err => {
        console.error('Error recreating tables:', err);
      });
      return;
    }
    
    insertData(key, value, timestamp, metadata);
  });
}

function insertData(key, value, timestamp, metadata) {
  // First insert the new data
  db.run(
    `INSERT INTO stream_data (key, value, timestamp, description, ops_nom, eng_nom, units, min_value, max_value, enum_values, format_spec) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [key, value, timestamp, metadata.description, metadata.ops_nom, metadata.eng_nom, metadata.units, 
     metadata.min_value, metadata.max_value, metadata.enum_values, metadata.format_spec],
    function(err) {
      if (err) {
        // Skip unique constraint errors (duplicate key+timestamp)
        if (!err.message.includes('UNIQUE constraint failed')) {
          console.error('Error storing data:', err.message);
        }
      } else {
        // Then delete any excess records beyond the last 100 for this key
        db.run(
          `DELETE FROM stream_data WHERE id IN (
            SELECT id FROM stream_data 
            WHERE key = ? 
            ORDER BY timestamp DESC 
            LIMIT -1 OFFSET 100
          )`,
          [key],
          (err) => {
            if (err) {
              console.error('Error pruning old data:', err.message);
            }
          }
        );
      }
    }
  );
}

// API Routes

// Get all data points - organized by key
app.get('/api/data', (req, res) => {
  db.all(`SELECT * FROM stream_data ORDER BY key, timestamp DESC`, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    // Organize data by key
    const organizedData = {};
    rows.forEach(row => {
      if (!organizedData[row.key]) {
        organizedData[row.key] = {
          key: row.key,
          description: row.description,
          ops_nom: row.ops_nom,
          eng_nom: row.eng_nom,
          units: row.units,
          min_value: row.min_value,
          max_value: row.max_value, 
          enum_values: row.enum_values,
          format_spec: row.format_spec,
          values: []
        };
      }
      
      organizedData[row.key].values.push({
        value: row.value,
        timestamp: row.timestamp,
        id: row.id
      });
    });
    
    // Convert to array and sort by key
    const result = Object.values(organizedData).sort((a, b) => a.key.localeCompare(b.key));
    res.json(result);
  });
});

// Get all data points for a specific key
app.get('/api/data/:key', (req, res) => {
  const key = req.params.key;
  db.all(
    `SELECT * FROM stream_data WHERE key = ? ORDER BY timestamp DESC`,
    [key],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      if (rows.length === 0) {
        res.status(404).json({ error: `No data found for key: ${key}` });
        return;
      }
      
      // Format the response
      const result = {
        key: key,
        description: rows[0].description || '',
        ops_nom: rows[0].ops_nom || '',
        eng_nom: rows[0].eng_nom || '',
        units: rows[0].units || '',
        min_value: rows[0].min_value || '',
        max_value: rows[0].max_value || '',
        enum_values: rows[0].enum_values || '',
        format_spec: rows[0].format_spec || '',
        values: rows.map(row => ({
          value: row.value,
          timestamp: row.timestamp,
          id: row.id
        }))
      };
      
      res.json(result);
    }
  );
});

// Get the latest data point for each key
app.get('/api/latest', (req, res) => {
  db.all(
    `SELECT sd.* FROM stream_data sd
     INNER JOIN (
       SELECT key, MAX(timestamp) as max_timestamp
       FROM stream_data
       GROUP BY key
     ) latest
     ON sd.key = latest.key AND sd.timestamp = latest.max_timestamp
     ORDER BY sd.key`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      // Format the response
      const result = rows.reduce((acc, row) => {
        acc[row.key] = {
          value: row.value,
          timestamp: row.timestamp,
          description: row.description || '',
          ops_nom: row.ops_nom || '',
          eng_nom: row.eng_nom || '',
          units: row.units || '',
          min_value: row.min_value || '',
          max_value: row.max_value || '',
          enum_values: row.enum_values || '',
          format_spec: row.format_spec || ''
        };
        return acc;
      }, {});
      
      res.json(result);
    }
  );
});

// Get a list of all available keys with metadata
app.get('/api/keys', (req, res) => {
  db.all(
    `SELECT DISTINCT key, description, ops_nom, eng_nom, units, min_value, max_value, enum_values, format_spec
     FROM stream_data 
     GROUP BY key
     ORDER BY key`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});


const trigger = () => {
    setInterval(() => {
        // Nums
      fetch("https://25c6c83b-4215-44b2-a22a-46ad714fc8c0.dcn.datacards.app/api/execute/graph/notebook/8d8ed033-38cb-438a-b37d-23f6e5731e55", {
        "headers": {
          "authorization": "Bearer AQZzZXJ2ZXIBAf30Xu5FlgEAACCI1OoakX3Q-jYDx8vt1Zi1F3n11dHrXwFbgBsMrw7Rnw",
          "content-type": "application/json",
        },
        "body": "{}",
        "method": "POST"
      });
    //   // Histo
    //   fetch("https://25c6c83b-4215-44b2-a22a-46ad714fc8c0.dcn.datacards.app/api/execute/graph/notebook/85076b2e-05ed-469f-8c64-26abb74a4081", {
    //     "headers": {
    //       "authorization": "Bearer AQZzZXJ2ZXIBAf30Xu5FlgEAACCI1OoakX3Q-jYDx8vt1Zi1F3n11dHrXwFbgBsMrw7Rnw",
    //       "content-type": "application/json",
    //     },
    //     "body": "{}",
    //     "method": "POST"
    //   });
    //   // urine
    //   fetch("https://25c6c83b-4215-44b2-a22a-46ad714fc8c0.dcn.datacards.app/api/execute/graph/notebook/f2ac2c0b-6ebe-4c22-af43-f24e90c63274", {
    //     "headers": {
    //       "authorization": "Bearer AQZzZXJ2ZXIBAf30Xu5FlgEAACCI1OoakX3Q-jYDx8vt1Zi1F3n11dHrXwFbgBsMrw7Rnw",
    //       "content-type": "application/json",
    //     },
    //     "body": "{}",
    //     "method": "POST"
    //   });
    }, 10000);
}

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await createTables();
    connectToLightstreamer();
    // trigger();
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }
}); 