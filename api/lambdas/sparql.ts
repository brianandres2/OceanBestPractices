import got from 'got';
import type { APIGatewayProxyEventV2, APIGatewayProxyResult } from 'aws-lambda';
import { pick } from 'lodash';
import { getStringFromEnv } from '../../lib/env-utils';
import { httpsOptions } from '../../lib/got-utils';

const defaultHeaders = {
  'Access-Control-Allow-Origin': '*',
};

export const okResponse = (
  contentType: string,
  body: string
): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: {
    ...defaultHeaders,
    'Content-Type': contentType,
  },
  body,
});

export const badRequestResponse = (
  body: string,
  contentType?: string
): APIGatewayProxyResult => ({
  statusCode: 400,
  headers: {
    ...defaultHeaders,
    'Content-Type': contentType ?? 'text/plain',
  },
  body,
});

export const internalServerErrorResponse: APIGatewayProxyResult = {
  statusCode: 500,
  headers: {
    ...defaultHeaders,
    'Content-Type': 'text/plain',
  },
  body: 'Internal Server Error',
};

export const badGatewayResponse: APIGatewayProxyResult = {
  statusCode: 502,
  headers: {
    ...defaultHeaders,
    'Content-Type': 'text/plain',
  },
  body: 'Bad Gateway',
};

export type PostSparqlEvent = Pick<APIGatewayProxyEventV2, 'body'>;

export const handler = async (
  event: PostSparqlEvent
): Promise<APIGatewayProxyResult> => {
  let sparqlUrl: string;
  try {
    sparqlUrl = getStringFromEnv('SPARQL_URL');
  } catch {
    console.log('SPARQL_URL not set');
    return internalServerErrorResponse;
  }

  const query = event.body;

  if (!query) {
    return badRequestResponse('No query specified in request body');
  }

  const response = await got.post(
    sparqlUrl,
    {
      form: { query },
      throwHttpErrors: false,
      https: httpsOptions(sparqlUrl),
    }
  );

  const contentType = response.headers['content-type'];

  if (!contentType) return badGatewayResponse;

  if (response.statusCode === 400) {
    return badRequestResponse(response.body, contentType);
  }

  if (response.statusCode !== 200) {
    const responseToLog = pick(response, ['statusCode', 'headers', 'body']);

    console.log(
      'Unexpected server response:',
      JSON.stringify(responseToLog, undefined, 2)
    );

    return internalServerErrorResponse;
  }

  return okResponse(contentType, response.body);
};
