import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './config.js';

// The mongodb+srv:// URI needs an SRV DNS lookup before it can connect at
// all. On Windows, Node's own DNS resolver doesn't reliably pick up the OS's
// configured DNS servers for that lookup — confirmed on this machine:
// Windows' native resolver (Resolve-DnsName) found the Atlas cluster's SRV
// record every time, on every DNS server tried, while Node intermittently
// got ESERVFAIL from whichever resolver it auto-detected. Pinning known-
// reliable public resolvers fixes it at the source instead of retrying
// against a resolver that may or may not work this run.
dns.setServers(config.dnsServers);

export const connectToDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongodbUri, { dbName: config.mongodbName });
    console.log(`[db] connected to MongoDB (database: ${config.mongodbName})`);
  } catch (error) {
    console.error('[db] failed to connect to MongoDB', error);
    throw error;
  }
};
