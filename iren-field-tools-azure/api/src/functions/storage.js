// Storage API for IREN Field Tools.
//
// Implements the same get / set / delete contract the app was originally
// written against (Claude's window.storage), so the app itself did not have
// to change: index.html defines a small window.storage shim that calls this
// endpoint, and everything else in the app is untouched.
//
// Data lives in Azure Blob Storage, one blob per key:
//   shared keys  -> shared/<key>                 (visible to every signed-in user)
//   personal keys -> users/<userId>/<key>        (private to that user)
//
// Authentication is enforced by Azure Static Web Apps in front of this
// function (see staticwebapp.config.json). SWA injects the signed-in user's
// identity in the x-ms-client-principal header and strips any copy a client
// tries to send, so it can be trusted here.

const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER = 'qc-storage';
let containerClientPromise = null;

function getContainerClient() {
  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (!conn) throw new Error('STORAGE_CONNECTION_STRING is not configured');
      const service = BlobServiceClient.fromConnectionString(conn);
      const container = service.getContainerClient(CONTAINER);
      await container.createIfNotExists();
      return container;
    })();
  }
  return containerClientPromise;
}

function getUser(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    const principal = JSON.parse(decoded);
    return principal && principal.userId ? principal : null;
  } catch (e) {
    return null;
  }
}

// Keys are used as blob path segments, so only allow a conservative charset.
const KEY_PATTERN = /^[A-Za-z0-9:_\-.]{1,200}$/;

function blobNameFor(key, shared, user) {
  if (!KEY_PATTERN.test(key)) {
    const err = new Error('Invalid key');
    err.status = 400;
    throw err;
  }
  return shared ? `shared/${key}` : `users/${user.userId}/${key}`;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parseShared(value) {
  return value === '1' || value === 'true' || value === true;
}

app.http('storage', {
  methods: ['GET', 'PUT', 'DELETE'],
  authLevel: 'anonymous', // SWA enforces sign-in; we verify the principal header below
  route: 'storage',
  handler: async (request, context) => {
    const user = getUser(request);
    if (!user) return { status: 401, jsonBody: { error: 'Not signed in' } };

    try {
      const container = await getContainerClient();

      if (request.method === 'GET') {
        const key = request.query.get('key');
        const shared = parseShared(request.query.get('shared'));
        if (!key) return { status: 400, jsonBody: { error: 'key is required' } };
        const blob = container.getBlobClient(blobNameFor(key, shared, user));
        try {
          const download = await blob.download();
          const value = await streamToString(download.readableStreamBody);
          return { status: 200, jsonBody: { key, value, shared } };
        } catch (e) {
          if (e.statusCode === 404) return { status: 404, jsonBody: { error: 'Key not found', key } };
          throw e;
        }
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        const key = body && body.key;
        const value = body && body.value;
        const shared = parseShared(body && body.shared);
        if (!key) return { status: 400, jsonBody: { error: 'key is required' } };
        if (typeof value !== 'string') return { status: 400, jsonBody: { error: 'value must be a string' } };
        const blob = container.getBlockBlobClient(blobNameFor(key, shared, user));
        await blob.upload(value, Buffer.byteLength(value, 'utf8'), {
          blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
        });
        return { status: 200, jsonBody: { key, value, shared } };
      }

      if (request.method === 'DELETE') {
        const key = request.query.get('key');
        const shared = parseShared(request.query.get('shared'));
        if (!key) return { status: 400, jsonBody: { error: 'key is required' } };
        const blob = container.getBlobClient(blobNameFor(key, shared, user));
        const result = await blob.deleteIfExists();
        return { status: 200, jsonBody: { key, deleted: result.succeeded, shared } };
      }

      return { status: 405, jsonBody: { error: 'Method not allowed' } };
    } catch (e) {
      if (e.status === 400) return { status: 400, jsonBody: { error: e.message } };
      context.error('storage error', e);
      return { status: 500, jsonBody: { error: 'Storage operation failed' } };
    }
  }
});
