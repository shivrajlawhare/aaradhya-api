import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer: MongoMemoryServer | undefined;

export const connectTestDb = async (): Promise<void> => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), { dbName: 'aaradhya-test' });
};

export const disconnectTestDb = async (): Promise<void> => {
  await mongoose.disconnect();
  await memoryServer?.stop();
  memoryServer = undefined;
};

export const clearCollections = async (): Promise<void> => {
  const { collections } = mongoose.connection;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
};
