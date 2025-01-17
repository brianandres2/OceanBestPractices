/* eslint-disable no-underscore-dangle */
import got4aws from 'got4aws';
import { get } from 'lodash';
import pMap from 'p-map';
import { z } from 'zod';
import {
  CloseScrollResponse,
  DocumentItem,
  DocumentItemTerm,
  PutDocumentItemResponse,
  closeScrollResponseSchema,
  countResponseSchema,
  percolateResponseSchema,
  putDocumentItemResponseSchema,
  suggestTermsResponseSchema,
} from './open-search-schemas';
import { documentsMapping } from './documents-mapping';
import { termsMapping } from './terms-mapping';
import { isHTTPError } from './got-utils';

const gotEs = (prefixUrl: string) => got4aws().extend({
  prefixUrl,
  responseType: 'json',
  resolveBodyOnly: true,
});

export interface OpenScrollOptions {
  includes?: string[]
  scrollTimeout?: number,
  size?: number
}

/**
 * Queries OpenSearch for all items and returns them while also
 * opening a scroll.
 * See https://opensearch.org/docs/latest/opensearch/rest-api/scroll/
 * for more details.
 *
 * @param prefixUrl - Open Search endpoint.
 * @param index - Name of the index to query.
 * @param options - Options to the request.
 * @param {string[]} [options.includes=['*']] -
 *
 * @returns Open Search query results including a
 * scroll ID.
 */
export const openScroll = async (
  prefixUrl: string,
  index: string,
  options: OpenScrollOptions = {}
): Promise<unknown> => {
  const {
    includes = ['*'],
    scrollTimeout = 60,
    size = 500,
  } = options;

  // eslint-disable-next-line no-return-await
  return await gotEs(prefixUrl).post(
    `${index}/_search`,
    {
      searchParams: {
        scroll: `${scrollTimeout}m`,
      },
      json: {
        _source: {
          includes,
        },
        size,
      },
    }
  );
};

/**
 * Returns search results for an open Open Search scroll.
 * See https://opensearch.org/docs/latest/opensearch/rest-api/scroll/
 * for more details.
 *
 * @param prefixUrl - Open Search endpoint.
 * @param scrollId - Scroll ID of the open scroll.
 *
 * @returns Open Search query results including scroll ID. The scroll ID
 * in this response should always be used in future next scroll requests.
 */
export const nextScroll = async (
  prefixUrl: string,
  scrollId: string,
  scrollTimeout = 60
): Promise<unknown> => gotEs(prefixUrl).post(
  '_search/scroll',
  {
    json: {
      scroll: `${scrollTimeout}m`,
      scroll_id: scrollId,
    },
  }
);

/**
 * Closes an open Open Search scroll query.
 * See https://opensearch.org/docs/latest/opensearch/rest-api/scroll/
 * for more details.
 *
 * @param prefixUrl - Open Search endpoint.
 * @param scrollId - Scroll ID of the open scroll.
 *
 * @returns Open Search close scroll response.
 */
export const closeScroll = async (
  prefixUrl: string,
  scrollId: string
): Promise<CloseScrollResponse> => {
  const rawResponse = await gotEs(prefixUrl)
    .delete(
      `_search/scroll/${scrollId}`
    );

  return closeScrollResponseSchema.parse(rawResponse);
};

/**
 * Deletes items from an Open Search index using the _bulk API.
 * See: https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html
 *
 * @param prefixUrl - Open Search endpoint.
 * @param index - Name of the index where the items exist.
 * @param ids - List of IDs to delete.
 *
 * @returns Result of Open Search bulk delete.
 */
export const bulkDelete = async (
  prefixUrl: string,
  index: string,
  ids: string[]
): Promise<unknown> => {
  const bulkData = ids.map((id) => ({
    delete: {
      _index: index,
      _type: '_doc',
      _id: id,
    },
  }));

  // eslint-disable-next-line no-return-await
  return await got4aws().post(
    '_bulk',
    {
      prefixUrl,
      body: `${bulkData.map((d) => JSON.stringify(d)).join('\n')}\n`,
      responseType: 'json',
      resolveBodyOnly: true,
    }
  );
};

export interface PercolateDocumentFieldsOptions {
  from?: number
  size?: number
}

/**
 * Executes a percolator query against the terms index using the given
 * document index fields. This query takes document key/values and finds
 * the terms that match those field values. It returns a modified
 * percolator query result.
 * See https://www.elastic.co/guide/en/elasticsearch/reference/6.8/query-dsl-percolate-query.html
 * for more information.
 *
 * @param prefixUrl - Open Search endpoint.
 * @param fields - Key/value index fields to use to match
 * the percolator query.
 * @param options - Options for the request.
 *
 * @returns Modified percolator query result.
 * The result will be a list of objects that includes the matched term
 * label, uri, and source_terminology.
 */
export const percolateDocumentFields = async (
  prefixUrl: string,
  termsIndexName: string,
  fields: { title: string, contents: string },
  options: PercolateDocumentFieldsOptions = {}
): Promise<DocumentItemTerm[]> => {
  const {
    from = 0,
    size = 300,
  } = options;

  const body = {
    query: {
      percolate: {
        field: 'query',
        document: fields,
      },
    },
    from,
    size,
  };

  const rawPercolateResponse = await gotEs(prefixUrl).post(
    `${termsIndexName}/_search`,
    {
      json: body,
    }
  ).catch((error) => {
    if (isHTTPError(error)) {
      console.log(
        'HTTPError - POST /terms/_search failed, statusCode:',
        error.response.statusCode,
        'body:',
        error.response.body
      );
    }
    throw error;
  });

  const percolateResponse = percolateResponseSchema
    .safeParse(rawPercolateResponse);

  if (!percolateResponse.success) {
    console.log(`ERROR: Failed to parse percolate response: ${percolateResponse.error}`);
    throw percolateResponse.error;
  }

  // It's possible we'll tweak this response as we improve the
  // percolator query. Leaving this as is for now.
  const { hits: { hits } } = percolateResponse.data;
  return hits.map((h) => ({
    label: h._source.query.multi_match.query,
    uri: h._source.uri,
    source_terminology: h._source.source_terminology,
    namedGraphUri: h._source.namedGraphUri,
  }));
};

/**
 * @param prefixUrl
 * @param index
 */
export const getIndex = (
  prefixUrl: string,
  index: string
): Promise<unknown> => gotEs(prefixUrl).get(index);

/**
  * @param prefixUrl
  * @param index
  * @param indexBody
  */
export const createIndex = (
  prefixUrl: string,
  index: string,
  indexBody?: Record<string, unknown>
): Promise<void> =>
  gotEs(prefixUrl).put(
    index,
    {
      json: indexBody,
      resolveBodyOnly: false,
      throwHttpErrors: false,
    }
  ).then(({ statusCode, body }) => {
    if (statusCode === 200) return;

    const errorMessage = get(
      body,
      'error.type',
      `Unexpected ${statusCode} response: ${JSON.stringify(body, undefined, 2)}`
    );

    if (errorMessage === 'resource_already_exists_exception') {
      console.log(`INFO: index "${index}" already exists.`);
      return;
    }

    throw new Error(errorMessage);
  });

/**
 * Indexes a document item into the documents index.
 *
 * @param prefixUrl - Open Search endpoint.
 * @param documentItem - Object to index.
 */
export const putDocumentItem = async (
  prefixUrl: string,
  documentItem: DocumentItem
): Promise<PutDocumentItemResponse> => {
  const rawResponse = await gotEs(prefixUrl).post(
    `documents/_doc/${documentItem.uuid}`,
    {
      json: documentItem,
    }
  ).catch((error) => {
    if (isHTTPError(error)) {
      console.log(
        `HTTPError - POST documents/_doc/${documentItem.uuid} failed, statusCode:`,
        error.response.statusCode,
        'body:',
        error.response.body
      );
    }
  });

  return putDocumentItemResponseSchema.parse(rawResponse);
};

export const createDocumentsIndex = (
  prefixUrl: string,
  index: string
): Promise<unknown> => createIndex(prefixUrl, index, documentsMapping);

/**
 * @param prefixUrl
 * @param index
 */
export const createTermsIndex = (
  prefixUrl: string,
  index: string
): Promise<unknown> => createIndex(prefixUrl, index, termsMapping);

/**
 * @param prefixUrl
 * @param index
 */
export const indexExists = async (
  prefixUrl: string,
  index: string
): Promise<boolean> => gotEs(prefixUrl).head(index, {
  resolveBodyOnly: false,
  throwHttpErrors: false,
}).then(({ statusCode }) => statusCode === 200);

/**
 * @param prefixUrl
 * @param index
 * @param doc
 */
export const addDocument = async (
  prefixUrl: string,
  index: string,
  doc: Record<string, unknown>
): Promise<unknown> =>
  gotEs(prefixUrl).post(`${index}/_doc`, { json: doc });

/**
* @param prefixUrl
* @param index
* @param id
*/
export const getDocument = async (
  prefixUrl: string,
  index: string,
  id: string
): Promise<unknown> =>
  gotEs(prefixUrl).get(`${index}/_doc/${id}`)
    .catch((error) => {
      const statusCode = get(error, 'response.statusCode');

      if (statusCode !== 404) throw error;
    });

/**
* @param prefixUrl
* @param index
* @param query
*/
export const deleteByQuery = async (
  prefixUrl: string,
  index: string,
  query: Record<string, unknown>
): Promise<unknown> =>
  gotEs(prefixUrl).post(
    `${index}/_delete_by_query`,
    {
      json: { query },
    }
  );

export const refreshIndex = async (
  prefixUrl: string,
  index: string
): Promise<void> => {
  await gotEs(prefixUrl).post(`${index}/_refresh`);
};

export const deleteIndex = async (
  prefixUrl: string,
  index: string
): Promise<void> => {
  await gotEs(prefixUrl).delete(`${index}`);
};

const scrollResponseSchema = z.object({
  _scroll_id: z.string(),
  hits: z.object({
    hits: z.array(z.unknown()),
  }),
});

/**
 * Iterate over ElasticSearch Scroll API hits, applying `f` to each hit.
 */
export const scrollMap = async (params: {
  esUrl: string,
  index: string,
  handler: (i: unknown) => Promise<void>,
  pMapOptions?: pMap.Options,
  scrollOptions?: OpenScrollOptions
}): Promise<void> => {
  const {
    esUrl,
    index,
    handler: f,
    pMapOptions,
    scrollOptions,
  } = params;

  const rawOpenScrollResponse = await openScroll(esUrl, index, scrollOptions);

  const openScrollResponse = scrollResponseSchema.parse(rawOpenScrollResponse);

  const scrollId = openScrollResponse._scroll_id;

  let { hits } = openScrollResponse.hits;

  try {
    /* eslint-disable no-await-in-loop */
    while (hits.length > 0) {
      await pMap(hits, f, pMapOptions);

      const nextScrollResponse = scrollResponseSchema.parse(
        await nextScroll(esUrl, scrollId)
      );

      hits = nextScrollResponse.hits.hits;
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    await closeScroll(esUrl, scrollId);
  }
};

export const updateDocument = async (
  esUrl: string,
  index: string,
  id: string,
  doc?: unknown
): Promise<void> => {
  const json = { doc };

  await gotEs(esUrl).post(`${index}/_update/${id}`, { json });
};

export const getCount = async (
  prefixUrl: string,
  index: string
): Promise<number> => {
  const rawResult = await gotEs(prefixUrl).get(`${index}/_count`);
  const result = countResponseSchema.parse(rawResult);

  return result.count;
};

export const searchByQuery = async (
  prefixUrl: string,
  index: string,
  query: Record<string, unknown>
): Promise<unknown> => gotEs(prefixUrl).post(
  `${index}/_search`,
  { json: query }
);

export const suggestTerms = async (
  prefixUrl: string,
  termsIndexName: string,
  input: string
): Promise<string[]> => {
  const suggest = {
    termSuggest: {
      prefix: input,
      completion: {
        field: 'suggest',
      },
    },
  };

  const rawResponse = await searchByQuery(
    prefixUrl,
    termsIndexName,
    { suggest }
  );

  const suggestResponse = suggestTermsResponseSchema.parse(rawResponse);
  const [suggestions] = suggestResponse.suggest.termSuggest;

  if (!suggestions) {
    return [];
  }

  return suggestions.options.map((s) => (s.text));
};
