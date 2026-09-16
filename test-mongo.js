const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://yatree_admin:Mayank123@cluster0.iuq9w0n.mongodb.net/Unnati-arts?retryWrites=true&w=majority';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
async function run() {
  try {
    await client.connect();
    console.log('Connected successfully to MongoDB server');
    const adminDb = client.db('test').admin();
    const info = await adminDb.ping();
    console.log('Ping result:', info);
  } catch (err) {
    console.error('Connection error:', err);
  } finally {
    await client.close();
  }
}
run();
