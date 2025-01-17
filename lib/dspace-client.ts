import got, { HTTPError } from 'got';
import { Parser } from 'xml2js';
import { z } from 'zod';

import {
  DSpaceItem,
  dspaceItemSchema,
  Metadata,
  metadataSchema,
  RSSFeed,
  rssFeedSchema,
} from './dspace-schemas';

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5',
} as const;

/**
 * Searches for DSpace items that match the given metadata field and value.
 * Includes the metadata and bitstreams fields for each matched item.
 *
 * @param endpoint - DSpace endpoint. Should include protocol.
 * @param key - Metadata field key
 * @param value - Metadata field value
 * @returns List of DSpace items that match the query.
 */
export const find = async (
  endpoint: string,
  key: string,
  value: string
): Promise<DSpaceItem[]> => {
  const findItems = await got.post(
    `${endpoint}/rest/items/find-by-metadata-field`,
    {
      json: {
        key,
        value,
      },
      searchParams: {
        expand: 'metadata,bitstreams',
      },
      responseType: 'json',
      resolveBodyOnly: true,
      headers,
    }
  );

  return z.array(dspaceItemSchema).parse(findItems);
};

/**
 * Fetches the DSpace RSS feed.
 *
 * @param endpoint - DSpace endpoint. Should include protocol.
 * @returns Parsed DSpace RSS feed.
 */
export const getFeed = async (endpoint: string): Promise<RSSFeed> => {
  const rawFeedXML = await got(`${endpoint}/feed/rss_2.0/site`, {
    headers: {
      ...headers,
      Accept: 'application/xml',
    },
    resolveBodyOnly: true,
  });

  const parser = new Parser({ explicitRoot: false });
  const rawFeed = await parser.parseStringPromise(rawFeedXML);

  return rssFeedSchema.parse(rawFeed);
};

export interface GetItemsSearchParams {
  expand?: 'none' | 'metadata' | 'bitstreams',
  limit?: number,
  offset?: number
}

/**
 * Returns DSpace items within the scope of the provided limit
 * and offset values.
 *
 * @param endpoint - DSpace endpoint. Should include protocol.
 * @param searchParams - Optional query parameters.
 *
 * @returns List of DSpace items.
 */
export const getItems = async (
  endpoint: string,
  searchParams: GetItemsSearchParams = {}
): Promise<DSpaceItem[]> => {
  const {
    expand = 'bitstreams,metadata',
    limit = 50,
    offset = 0,
  } = searchParams;

  const getItemsResponse = await got.get(`${endpoint}/rest/items`, {
    headers,
    searchParams: {
      expand,
      limit,
      offset,
    },
    responseType: 'json',
    resolveBodyOnly: true,
  });

  return z.array(dspaceItemSchema).parse(getItemsResponse);
};

/**
 * Gets a DSpace item for the given UUID. Returns an empty object if
 * no item is found for the given UUID. This returns the full DSpace
 * item including metadata and bitstreams.
 *
 * @param endpoint - DSpace endpoint. Should include protocol.
 * @param uuid - DSpace item UUID.

  * @returns DSpace item or undefined if not
  * found.
  */
export const getItem = async (
  endpoint: string,
  uuid: string
): Promise<DSpaceItem | undefined> => {
  try {
    const getItemResponseBody = await got.get(`${endpoint}/rest/items/${uuid}`, {
      ...headers,
      searchParams: {
        expand: 'bitstreams,metadata',
      },
      responseType: 'json',
      resolveBodyOnly: true,
    });

    return dspaceItemSchema.parse(getItemResponseBody);
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return undefined;
    }

    throw error;
  }
};

/**
 * Gets the metadata for a DSpace item for the given UUID. Returns an
 * empty object if no item is found for the given UUID. This returns
 * only the metadata.
 *
 * @param endpoint - DSpace endpoint. Should include protocol.
 * @param uuid - DSpace item UUID.
 *
 * @returns Metadata for the DSpace item
 * or undefined if the item could not be found.
 */
export const getMetadata = async (
  endpoint: string,
  uuid: string
): Promise<Metadata[] | undefined> => {
  try {
    const getMetadataResponseBody = await got.get(`${endpoint}/rest/items/${uuid}/metadata`, {
      headers,
      responseType: 'json',
      resolveBodyOnly: true,
    });

    return z.array(metadataSchema).parse(getMetadataResponseBody);
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return undefined;
    }

    throw error;
  }
};

/**
 * Gets a bitstream file for the given bitstream retrieve link.
 *
 * @param endpoint - endpoint DSpace endpoint. Should include protocol.
 * @param retrieveLink - Bitstream retrieve link.
 *
 * @returns Bitstream file as a buffer.
 */
export const getBitstream = async (
  endpoint: string,
  retrieveLink: string
): Promise<Buffer> => got(`${endpoint}${retrieveLink}`, {
  headers: {
    ...headers,
    Accept: '*/*',
  },
  responseType: 'buffer',
  resolveBodyOnly: true,
});
