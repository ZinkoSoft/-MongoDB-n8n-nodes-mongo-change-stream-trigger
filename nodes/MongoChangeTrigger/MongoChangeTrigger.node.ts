import {
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	ITriggerFunctions,
	NodeApiError,
} from 'n8n-workflow';
import { MongoClient, ChangeStream, ChangeStreamDocument } from 'mongodb';

export class MongoChangeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mongo Change Trigger',
		name: 'mongoChangeTrigger',
		icon: 'file:mongodb.svg',
		group: ['trigger'],
		version: 1,
		description: 'Triggers a workflow on changes in a MongoDB collection that match specified filters',
		defaults: {
			name: 'Mongo Change Trigger',
		},
		inputs: [],
		outputs: ['main'], // Only one output
		credentials: [
			{
				name: 'mongoDbTriggerApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Database Name',
				name: 'database',
				type: 'string',
				default: '',
				placeholder: 'myDatabase',
				description: 'Name of the database to connect to',
			},
			{
				displayName: 'Collection Name',
				name: 'collection',
				type: 'string',
				default: '',
				placeholder: 'myCollection',
				description: 'The MongoDB collection to watch for changes',
			},
			{
				displayName: 'Fields to Monitor',
				name: 'fields',
				type: 'string',
				default: '*',
				placeholder: '* or a comma-separated list (e.g. status,priority)',
				description:
					'Enter "*" to listen for any change or a comma-separated list of specific fields to monitor for updates',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						name: 'filterValues',
						displayName: 'Filter',
						values: [
							{
								displayName: 'Field',
								name: 'field',
								type: 'string',
								default: '',
								description: 'Field to check in the updateDescription.updatedFields',
							},
							{
								displayName: 'Operator',
								name: 'operator',
								type: 'options',
								options: [
									{
										name: 'Equal To',
										value: 'equal',
									},
									{
										name: 'Not Equal To',
										value: 'notEqual',
									},
								],
								default: 'equal',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Value that the field should match to trigger the workflow',
							},
						],
					},
				],
				description:
					'Define filters to only trigger the workflow when all conditions are met',
				},
				{
					displayName: 'Operation Types',
					name: 'operationTypes',
					type: 'multiOptions',
					options: [
						{
							name: 'Delete',
							value: 'delete',
							description: 'Trigger on document deletions',
						},
						{
							name: 'Drop',
							value: 'drop',
							description: 'Trigger when collection is dropped',
						},
						{
							name: 'Insert',
							value: 'insert',
							description: 'Trigger on document insertions',
						},
						{
							name: 'Rename',
							value: 'rename',
							description: 'Trigger when collection is renamed',
						},
						{
							name: 'Replace',
							value: 'replace',
							description: 'Trigger on document replacements',
						},
						{
							name: 'Update',
							value: 'update',
							description: 'Trigger on document updates',
						},
					],
					default: ['update'],
					description: 'Which operation types should trigger the workflow',
				},
			],
		};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		// Retrieve credentials from the mongoDb credentials node
		const credentials = await this.getCredentials('mongoDbTriggerApi');
		if (!credentials) {
			throw new NodeApiError(this.getNode(), { message: 'No credentials were returned!' });
		}

		// Get node parameters
		const database = this.getNodeParameter('database', '') as string;
		const collectionName = this.getNodeParameter('collection', '') as string;
		const fields = this.getNodeParameter('fields', '*') as string;
		const operationTypes = this.getNodeParameter('operationTypes', ['update']) as string[];
		// Get the list of filters (each filter has a field, operator, and value)
		const filters = this.getNodeParameter('filters.filterValues', []) as Array<{
			field: string;
			operator: string;
			value: string;
		}>;

		// Build the connection URI – assumes the credentials object contains a property called "uri"
		const uri = credentials.connectionString as string;
		let client: MongoClient;

		try {
			client = new MongoClient(uri);
			await client.connect();
		} catch (error) {
			throw new NodeApiError(this.getNode(), error, {
				message: 'Failed to connect to MongoDB. Please check your credentials and connection settings.',
			});
		}

		const db = client.db(database);

		try {
				// Try to verify database existence with a simple command that requires fewer permissions
				try {
					// The ping command only requires read access to the database
					await db.command({ ping: 1 });
				} catch (error) {
					// If we can't access the database, it either doesn't exist or we lack permissions
					if (error.message?.includes("not authorized") || error.codeName === "Unauthorized") {
						throw new NodeApiError(this.getNode(), {
							message: `Not authorized to access database "${database}". Check if the database exists and your credentials have sufficient permissions.`,
						});
					} else {
						throw new NodeApiError(this.getNode(), {
							message: `Database "${database}" could not be accessed: ${error.message}`,
						});
					}
				}

				// Check if collection exists with targeted query instead of listing all collections
				try {
					const collections = await db.listCollections({ name: collectionName }).toArray();
					if (collections.length === 0) {
						throw new NodeApiError(this.getNode(), {
							message: `Collection "${collectionName}" does not exist in database "${database}".`,
						});
					}
				} catch (error) {
					if (error.message?.includes("not authorized") || error.codeName === "Unauthorized") {
						throw new NodeApiError(this.getNode(), {
							message: `Not authorized to list collections in "${database}". Check if your credentials have sufficient permissions.`,
						});
					} else {
						throw new NodeApiError(this.getNode(), error, {
							message: `Failed to verify if collection "${collectionName}" exists.`,
						});
					}
				}
			} catch (error) {
				// If it's already a NodeApiError, just pass it through
				if (error.name === 'NodeApiError') throw error;

				throw new NodeApiError(this.getNode(), error, {
					message: 'Failed to verify database or collection existence.',
				});
			}

		const collection = db.collection(collectionName);

		// Build the pipeline for the change stream.
		// If fields is "*", capture all changes; otherwise, filter for the provided fields.
		let pipeline = [];

		// Add operation type filtering
		if (operationTypes.length > 0 && operationTypes.length < 6) { // If not all types are selected
			pipeline.push({
				$match: {
					operationType: { $in: operationTypes }
				}
			});
		}

		// Add field filtering for update operations only
		if (fields !== '*' && operationTypes.includes('update')) {
			const fieldList = fields.split(',').map(field => field.trim());
			pipeline.push({
				$match: {
					$or: [
						{
							operationType: { $ne: 'update' } // Skip this filter for non-update operations
						},
						{
							$and: [
								{ operationType: 'update' },
								{ 'updateDescription.updatedFields': { $exists: true } },
								{
									$or: fieldList.map(field => ({
										[`updateDescription.updatedFields.${field}`]: { $exists: true },
									})),
								}
							]
						}
					]
				}
			});
		}

		const changeStream: ChangeStream = collection.watch(pipeline);

		// When a change occurs, transform the output to be more user-friendly
		changeStream.on('change', (change: ChangeStreamDocument<any>) => {
			// Create a simplified, more readable output object
			const formattedOutput = formatChangeOutput(change);

			// Apply filters for update operations
			if (filters.length > 0 && change.operationType === 'update') {
				const updatedFields = (change as any).updateDescription?.updatedFields || {};

				// Check if the change matches all filter conditions
				const allConditionsMet = filters.every(filter => {
					if (!updatedFields.hasOwnProperty(filter.field)) return false;

					const actualValue = updatedFields[filter.field];
					const expectedValue = filter.value;

					switch (filter.operator) {
						case 'equal': return actualValue === expectedValue;
						case 'notEqual': return actualValue !== expectedValue;
						default: return false;
					}
				});

				// Only emit if all conditions are met
				if (allConditionsMet) {
					this.emit([
						[{ json: formattedOutput }]
					]);
				}
			} else {
				// For non-update operations or when no filters are defined
				this.emit([
					[{ json: formattedOutput }]
				]);
			}
		});

		// Helper function to format change stream output in a more readable way
		function formatChangeOutput(change: ChangeStreamDocument<any>): any {
			// Create a base output object with essential information
			const output: Record<string, any> = {
				operation: change.operationType,
				timestamp: new Date((change as any).wallTime || Date.now()).toISOString(),
				database: (change as any).ns?.db || database,
				collection: (change as any).ns?.coll || collectionName,
				documentId: ('documentKey' in change) ? change.documentKey?._id?.toString() : undefined,
			};

			// Add operation-specific data
			switch (change.operationType) {
				case 'insert':
					output.document = change.fullDocument || {};
					break;

				case 'update':
					output.modifiedFields = (change as any).updateDescription?.updatedFields || {};
					output.removedFields = (change as any).updateDescription?.removedFields || [];
					if (change.fullDocument) {
						output.documentAfterUpdate = change.fullDocument;
					}
					break;

				case 'replace':
					output.documentAfterReplace = change.fullDocument || {};
					break;

				case 'delete':
					// No additional fields needed, documentId is already included
					break;

				case 'drop':
				case 'rename':
					if (change.operationType === 'rename') {
						output.newCollection = (change as any).to?.coll;
					}
					break;

				default:
					// For any other operation types, include the raw event details
					output.details = change;
			}

			return output;
		}

		// Cleanup function to close the change stream and MongoDB connection when the workflow stops.
		const closeFunction = async () => {
			await changeStream.close();
			await client.close();
		};

		return {
			closeFunction,
		};
	}
}
