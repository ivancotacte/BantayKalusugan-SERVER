import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);

async function connectMongoDB() {
    try {
        await client.connect();
        console.log('Connected to the database.');
        await refreshData();
        setInterval(refreshData, 60000);
    } catch (error) {
        console.error('Error connecting to MongoDB', error);
        res.status(500).json({ message: 'Error connecting to MongoDB', error });
    }
}

async function writeData(collectionName, data) {
    const db = client.db(process.env.MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    try {
        await collection.insertOne(data);
        console.log('Data written successfully');
    } catch (error) {
        console.error('Error writing data', error);
    }
}

async function readData(collectionName) {
    const db = client.db(process.env.MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    try {
        return await collection.find().toArray();
    } catch (error) {
        console.error('Error reading data', error);
    }
}

async function deleteData(collectionName, query) {
    const db = client.db(process.env.MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    try {
        await collection.deleteOne(query);
        console.log('Data deleted successfully');
    } catch (error) {
        console.error('Error deleting data', error);
    }
}

async function updateData(collectionName, query, data) {
    const db = client.db(process.env.MONGO_DB_NAME);
    const collection = db.collection(collectionName);
    try {
        await collection.updateOne(query, { $set: data });
        console.log('Data updated successfully');
    } catch (error) {
        console.error('Error updating data', error);
    }
}

async function refreshData() {
    try {
        await readData('users');
        await readData('health');
        console.log('Data refreshed successfully');
    } catch (error) {
        console.error('Error refreshing data', error);
    }
}

export { connectMongoDB, writeData, readData, deleteData, updateData, refreshData };