/* eslint-disable no-underscore-dangle */
import { buildDocumentSearchQuery } from './search-query-builder';

describe('search-document-builder', () => {
  describe('buildSearchDocument', () => {
    test('should build a full search document', () => {
      const options = {
        keywords: ['ocean', 'sea'],
        fields: ['title'],
        terms: ['alpha'],
        termURIs: ['uri://alpha'],
        from: 0,
        size: 20,
        refereed: true,
        endorsed: true,
        sort: ['title:asc'],
      };

      const result = buildDocumentSearchQuery(options);
      expect(result).toEqual({
        from: 0,
        size: 20,
        query: {
          bool: {
            must: {
              query_string: {
                fields: [
                  'title',
                ],
                query: ' "ocean"  "sea"',
              },
            },
            filter: [
              {
                nested: {
                  path: '_terms',
                  query: {
                    match: {
                      '_terms.label': 'alpha',
                    },
                  },
                },
              },
              {
                nested: {
                  path: '_terms',
                  query: {
                    match: {
                      '_terms.uri': 'uri://alpha',
                    },
                  },
                },
              },
              {
                exists: {
                  field: 'dc_description_refereed',
                },
              },
              {
                exists: {
                  field: 'obps_endorsementExternal_externalEndorsedBy',
                },
              },
            ],
          },
        },
        highlight: {
          fields: {
            _bitstreamText: {},
          },
        },
        sort: [
          {
            title: 'asc',
          },
          '_score',
        ],
        _source: {
          excludes: [
            '_bitstreamText',
            'bitstreams',
            'metadata',
          ],
        },
      });
    });
  });
});
