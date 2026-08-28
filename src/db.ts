import mongoose from 'mongoose';
import { config } from './config.js';

export const connectToDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(config.mongodbUri, { dbName: config.mongodbName });
    console.log(`[db] connected to MongoDB (database: ${config.mongodbName})`);
  } catch (error) {
    console.error('[db] failed to connect to MongoDB', error);
    throw error;
  }
};
