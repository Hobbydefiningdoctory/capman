import { describe, it, expect } from 'vitest'
import { parseOpenAPI } from '../src/parser'
import * as fs   from 'fs'
import * as path from 'path'

const sampleSpec = {
  openapi: '3.0.0',
  info: { title: 'Test API', description: 'A test API' },
  servers: [{ url: 'https://api.test.com' }],
  paths: {
    '/users/{user_id}': {
      get: {
        operationId: 'getUserById',
        summary: 'Get user by ID',
        description: 'Fetch a user by their unique ID.',
        parameters: [
          { name: 'user_id', in: 'path', required: true, description: 'User ID' },
        ],
        responses: { '200': { description: 'Success' } },
      },
      delete: {
        operationId: 'deleteUser',
        summary: 'Delete user',
        tags: ['admin'],
        parameters: [
          { name: 'user_id', in: 'path', required: true, description: 'User ID' },
        ],
        responses: { '200': { description: 'Success' } },
      },
    },
    '/articles': {
      get: {
        operationId: 'listArticles',
        summary: 'List all articles',
        description: 'Returns a list of all published articles.',
        parameters: [
          { name: 'tag',    in: 'query', required: false, description: 'Filter by tag' },
          { name: 'limit',  in: 'query', required: false, description: 'Max results' },
        ],
        responses: { '200': { description: 'Success' } },
      },
      post: {
        operationId: 'createArticle',
        summary: 'Create article',
        description: 'Create a new article.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'body'],
                properties: {
                  title: { type: 'string', description: 'Article title' },
                  body:  { type: 'string', description: 'Article body' },
                  tag:   { type: 'string', description: 'Article tag' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/health': {
      get: {
        summary: 'x',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

describe('parseOpenAPI()', () => {
  it('parses capabilities from spec object', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      expect(result.config.capabilities.length).toBeGreaterThan(0)
      expect(result.stats.total).toBeGreaterThan(0)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('extracts correct capability IDs from operationId', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      const ids = result.config.capabilities.map(c => c.id)
      expect(ids).toContain('get_user_by_id')
      expect(ids).toContain('list_articles')
      expect(ids).toContain('create_article')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('infers admin privacy from tags', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      const deleteUser = result.config.capabilities.find(c => c.id === 'delete_user')
      expect(deleteUser?.privacy.level).toBe('admin')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('infers user_owned privacy from security field', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      const createArticle = result.config.capabilities.find(c => c.id === 'create_article')
      expect(createArticle?.privacy.level).toBe('user_owned')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('extracts path and query params correctly', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      const getUser = result.config.capabilities.find(c => c.id === 'get_user_by_id')
      expect(getUser?.params.some(p => p.name === 'user_id')).toBe(true)
      expect(getUser?.params.find(p => p.name === 'user_id')?.required).toBe(true)

      const listArticles = result.config.capabilities.find(c => c.id === 'list_articles')
      expect(listArticles?.params.some(p => p.name === 'tag')).toBe(true)
      expect(listArticles?.params.find(p => p.name === 'tag')?.required).toBe(false)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('extracts request body fields as params', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      const createArticle = result.config.capabilities.find(c => c.id === 'create_article')
      const paramNames = createArticle?.params.map(p => p.name) ?? []
      expect(paramNames).toContain('title')
      expect(paramNames).toContain('body')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('extracts base URL from servers array', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      expect(result.config.baseUrl).toBe('https://api.test.com')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('skips operations with insufficient info', async () => {
    const fs = require('fs')
    const path = require('path')
    const tmp = path.join(process.cwd(), 'tmp-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(sampleSpec))

    try {
      const result = await parseOpenAPI(tmp)
      // /health GET has summary 'x' (< 5 chars) so should be skipped
      const ids = result.config.capabilities.map(c => c.id)
      const hasHealth = ids.some(id => id.includes('health'))
      expect(hasHealth).toBe(false)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('throws on missing file', async () => {
    await expect(parseOpenAPI('/nonexistent/path/spec.json'))
      .rejects.toThrow('Spec file not found')
  })

  it('does not classify manage/manager operations as admin', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/wishlist': {
          post: {
            operationId: 'manageWishlist',
            summary: 'Manage user wishlist',
            description: 'Add or remove items from the user wishlist.',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/admin/users': {
          get: {
            operationId: 'adminListUsers',
            summary: 'List all users',
            description: 'Admin endpoint to list all platform users.',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const tmp = path.join(process.cwd(), 'tmp-admin-test-spec.json')
    fs.writeFileSync(tmp, JSON.stringify(spec))
    let result: Awaited<ReturnType<typeof parseOpenAPI>>
    try {
      result = await parseOpenAPI(tmp)
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
