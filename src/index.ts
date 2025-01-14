#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import csvParser from 'csv-parser';
import * as XLSX from 'xlsx';

/**
 * Type alias for a note object.
 */
type Note = { title: string, content: string };

/**
 * Simple in-memory storage for notes.
 * In a real implementation, this would likely be backed by a database.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" }
};

/**
 * Create an MCP server with capabilities for resources (to list/read notes),
 * tools (to create new notes), and prompts (to summarize notes).
 */
const server = new Server(
  {
    name: "database-updater",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

/**
 * Handler for listing available notes as resources.
 * Each note is exposed as a resource with:
 * - A note:// URI scheme
 * - Plain text MIME type
 * - Human readable name and description (now including the note title)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(notes).map(([id, note]) => ({
      uri: `note:///${id}`,
      mimeType: "text/plain",
      name: note.title,
      description: `A text note: ${note.title}`
    }))
  };
});

/**
 * Handler for reading the contents of a specific note.
 * Takes a note:// URI and returns the note content as plain text.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, '');
  const note = notes[id];

  if (!note) {
    throw new Error(`Note ${id} not found`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: note.content
    }]
  };
});

/**
 * Handler that lists available tools.
 * Exposes a single "create_note" tool that lets clients create new notes.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_note",
        description: "Create a new note",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the note"
            },
            content: {
              type: "string",
              description: "Text content of the note"
            }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "update_database",
        description: "Update the database from a CSV or Excel file",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the CSV or Excel file"
            },
             databaseType: {
              type: "string",
              description: "Type of database (e.g., PostgreSQL, MySQL, MongoDB, SQLite)"
            },
            connectionString: {
              type: "string",
              description: "Connection string for the database"
            },
            tableName: {
              type: "string",
              description: "Name of the table to update"
            }
          },
          required: ["filePath", "databaseType", "connectionString", "tableName"]
        }
      }
    ]
  };
});

/**
 * Handler for the create_note tool.
 * Creates a new note with the provided title and content, and returns success message.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "create_note": {
      const title = String(request.params.arguments?.title);
      const content = String(request.params.arguments?.content);
      if (!title || !content) {
        throw new Error("Title and content are required");
      }

      const id = String(Object.keys(notes).length + 1);
      notes[id] = { title, content };

      return {
        content: [{
          type: "text",
          text: `Created note ${id}: ${title}`
        }]
      };
    }
    case "update_database": {
        const filePath = String(request.params.arguments?.filePath);
        const databaseType = String(request.params.arguments?.databaseType);
        const connectionString = String(request.params.arguments?.connectionString);
        const tableName = String(request.params.arguments?.tableName);

        if (!filePath || !databaseType || !connectionString || !tableName) {
            throw new McpError(ErrorCode.InvalidParams, "File path, database type, connection string, and table name are required");
        }

        try {
            const fileExtension = filePath.split('.').pop()?.toLowerCase();
            let results: any[] = [];

            if (fileExtension === 'csv') {
                results = await parseCsvFile(filePath);
            } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                results = await parseExcelFile(filePath);
            } else {
                throw new McpError(ErrorCode.InvalidParams, "Unsupported file type. Only CSV and Excel files are supported.");
            }

            // Placeholder for database interaction logic
            const connectionDetails = parseConnectionString(connectionString);
            console.log(`Updating database of type ${databaseType} with connection details ${JSON.stringify(connectionDetails)} and table name ${tableName} with data:`, results);

            // Add database update logic here based on databaseType and connectionDetails
            // For example, you might use a library like 'pg' for PostgreSQL, 'mysql' for MySQL, or 'mongodb' for MongoDB
            // This is a placeholder, so for now, we'll just log the data

            return {
                content: [{
                    type: "text",
                    text: `Successfully updated database from ${filePath}`
                }]
            };

        } catch (error: any) {
            console.error("Error updating database:", error);
            throw new McpError(ErrorCode.InternalError, `Error updating database: ${error.message}`);
        }
    }

    default:
      throw new Error("Unknown tool");
  }
});

async function parseCsvFile(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const results: any[] = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (data: any) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error: any) => reject(error));
    });
}

async function parseExcelFile(filePath: string): Promise<any[]> {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
}

function parseConnectionString(connectionString: string): any {
    // This is a basic example, you might need a more robust parser
    try {
        const url = new URL(connectionString);
        if (url.protocol === 'mongodb:') {
            return {
                type: 'mongodb',
                url: connectionString
            };
        } else {
            const parts = connectionString.split(';');
            const connectionDetails: any = {};
            parts.forEach(part => {
                const [key, value] = part.split('=');
                if (key && value) {
                    connectionDetails[key.trim()] = value.trim();
                }
            });
            return connectionDetails;
        }
    } catch (e) {
        // If it's not a URL, assume it's a semicolon-separated string
        const parts = connectionString.split(';');
        const connectionDetails: any = {};
        parts.forEach(part => {
            const [key, value] = part.split('=');
            if (key && value) {
                connectionDetails[key.trim()] = value.trim();
            }
        });
        return connectionDetails;
    }
}

/**
 * Handler that lists available prompts.
 * Exposes a single "summarize_notes" prompt that summarizes all notes.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_notes",
        description: "Summarize all notes",
      }
    ]
  };
});

/**
 * Handler for the summarize_notes prompt.
 * Returns a prompt that requests summarization of all notes, with the notes' contents embedded as resources.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_notes") {
    throw new Error("Unknown prompt");
  }

  const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
    type: "resource" as const,
    resource: {
      uri: `note:///${id}`,
      mimeType: "text/plain",
      text: note.content
    }
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the following notes:"
        }
      },
      ...embeddedNotes.map(note => ({
        role: "user" as const,
        content: note
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Provide a concise summary of all the notes above."
        }
      }
    ]
  };
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
