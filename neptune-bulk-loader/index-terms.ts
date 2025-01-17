import _ from 'lodash';
import got, { Got } from 'got';
import { z } from 'zod';
import got4aws from 'got4aws';
import { httpsOptions } from '../lib/got-utils';

const fetchTermsResponseSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        slabel: z.object({
          value: z.string(),
        }),
        s: z.object({
          value: z.string().url(),
        }),
      })
    ),
  }),
});

interface FetchedTerm {
  label: string
  uri: string
}

interface FetchTermsParams {
  offset: number
  sparqlUrl: string
  sparqlQuery: string
}

const fetchTerms = async (params: FetchTermsParams): Promise<FetchedTerm[]> => {
  const {
    offset,
    sparqlUrl,
    sparqlQuery,
  } = params;

  const query = `
${sparqlQuery}
LIMIT 500
OFFSET ${offset}`;

  const response = await got.post(
    sparqlUrl,
    {
      form: { query },
      responseType: 'json',
      https: httpsOptions(sparqlUrl),
      throwHttpErrors: false,
    }
  );

  if (response.statusCode !== 200) {
    throw new Error(`Neptune request failed with status ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }

  const parsedResponseBody = fetchTermsResponseSchema.parse(response.body);

  const { bindings } = parsedResponseBody.results;

  return bindings.map((b) => ({
    label: b.slabel.value,
    uri: b.s.value,
  }));
};

const indexForTerm = (indexName: string): unknown => ({
  index: {
    _index: indexName,
    _type: '_doc',
  },
});

const queryForTerm = (
  term: FetchedTerm,
  terminologyTitle: string,
  namedGraphUri: string
): unknown => ({
  label: term.label,
  suggest: [term.label],
  query: {
    multi_match: {
      query: term.label,
      type: 'phrase',
      fields: ['contents', 'title'],
    },
  },
  source_terminology: terminologyTitle,
  namedGraphUri,
  uri: term.uri,
});

interface BulkIndexTermsParams {
  elasticsearchClient: Got
  terms: FetchedTerm[]
  indexName: string
  terminologyTitle: string
  namedGraphUri: string
}

const bulkIndexTerms = async (params: BulkIndexTermsParams): Promise<void> => {
  const {
    elasticsearchClient,
    terms,
    indexName,
    terminologyTitle,
    namedGraphUri,
  } = params;

  const esDoc = _(terms)
    .map((term) => [
      indexForTerm(indexName),
      queryForTerm(term, terminologyTitle, namedGraphUri),
    ])
    .flatten()
    .map((x) => JSON.stringify(x))
    .join('\n');

  const body = `${esDoc}\n`;

  console.log('Starting bulk index of', terms.length, 'terms');
  const response = await elasticsearchClient.post(
    '_bulk',
    {
      headers: { 'Content-Type': 'application/json' },
      body,
      throwHttpErrors: false,
    }
  );

  if (response.statusCode !== 200) {
    throw new Error(`ES request failed with status ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }

  console.log('Finished bulk index of', terms.length, 'terms');
};

interface CreateTermIndexParams {
  elasticsearchUrl: string
  ontologyNameSpace: string
  namedGraphUri: string
  indexName: string
  terminologyTitle: string
  sparqlUrl: string
  sparqlQuery: string
  stopwords: string[]
}

export const indexTerms = async (
  params: CreateTermIndexParams
): Promise<void> => {
  const {
    elasticsearchUrl,
    namedGraphUri,
    terminologyTitle,
    indexName,
    sparqlUrl,
    sparqlQuery,
    stopwords,
  } = params;

  const elasticsearchClient = got4aws({
    service: 'es',
  }).extend({
    prefixUrl: elasticsearchUrl,
    https: httpsOptions(elasticsearchUrl),
  });

  let offset = 0;
  let terms: FetchedTerm[];

  while (true) { // eslint-disable-line no-constant-condition
    // eslint-disable-next-line no-await-in-loop
    terms = await fetchTerms({
      offset,
      sparqlUrl,
      sparqlQuery,
    });

    console.log('Got', terms.length, 'terms from Neptune');

    if (terms.length === 0) break;

    const validTerms = terms.filter(
      (t) => t.label.length > 2 && !stopwords.includes(t.label)
    );

    console.log('Got', validTerms.length, 'valid terms from Neptune');

    if (validTerms.length > 0) {
      await bulkIndexTerms({ // eslint-disable-line no-await-in-loop
        elasticsearchClient,
        terms: validTerms,
        indexName,
        terminologyTitle,
        namedGraphUri,
      });
    }

    console.log(`Indexed terms from ${offset} to ${offset + terms.length - 1}`);

    offset += terms.length;
  }
};
