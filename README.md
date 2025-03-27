# n8n-nodes-mongo-change-stream-trigger

This is an n8n community node. It lets you use MongoDB Change Streams in your n8n workflows.

MongoDB Change Streams allow applications to access real-time data changes without complex polling. This node listens for changes in MongoDB collections and triggers workflows when documents are inserted, updated, deleted, or when collections are modified.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

This node works as a trigger that starts workflows when changes occur in MongoDB:

- **Insert**: Triggers when new documents are added to a collection
- **Update**: Triggers when existing documents are modified
- **Replace**: Triggers when documents are replaced
- **Delete**: Triggers when documents are removed
- **Drop**: Triggers when collections are dropped
- **Rename**: Triggers when collections are renamed

## Credentials

You need to set up MongoDB credentials:

1. Create a new MongoDB connection in n8n (Credentials → New → MongoDB Trigger API)
2. Enter your MongoDB connection string (e.g., `mongodb://username:password@localhost:27017`)
3. The user needs at least read permissions on the target database and collection

**Note**: For change streams to work, your MongoDB deployment must be:
- A replica set or sharded cluster (not a standalone instance)
- MongoDB 3.6 or higher

## Compatibility

- Requires n8n version 0.125.0 or later
- Requires MongoDB 3.6 or later (with replica set or sharded cluster)

## Usage

1. **Basic Setup**:
   - Select the database and collection you want to monitor
   - Choose which operation types you want to trigger on (insert, update, delete, etc.)
   
2. **Field Monitoring**:
   - Use `*` to listen for any changes
   - Enter specific field names (comma-separated) to only trigger when these fields change

3. **Filtering**:
   - Add filters to only trigger when specific field values match your conditions
   - Example: Only trigger when `status` field equals `completed`

4. **Output Format**:
   The node produces a clean, readable output with:
   - Operation type (insert, update, etc.)
   - Timestamp of the change
   - Database and collection names
   - Document ID
   - Changed fields and values (for updates)
   - Complete document (for inserts)

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [MongoDB Change Streams documentation](https://www.mongodb.com/docs/manual/changeStreams/)
* [MongoDB Node.js Driver documentation](https://mongodb.github.io/node-mongodb-native/)


