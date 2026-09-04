import mongoose from 'mongoose';

let isConnected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prep_kit_db';

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    process.stdout.write(`[MongoDB] Connected successfully to host: ${conn.connection.host}\n`);
    return conn;
  } catch (error) {
    process.stderr.write(`[MongoDB] Connection error: ${error}\n`);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  if (isConnected || mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    process.stdout.write('[MongoDB] Disconnected cleanly\n');
  }
}
