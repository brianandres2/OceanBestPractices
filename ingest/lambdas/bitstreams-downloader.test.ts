import cryptoRandomString from 'crypto-random-string';
import { randomUUID } from 'crypto';
import nock from 'nock';
import { handler } from './bitstreams-downloader';
import * as s3Utils from '../../lib/s3-utils';
import * as lambdaClient from '../../lib/lambda-client';

const dspaceItemBucket = `bucket-${cryptoRandomString({ length: 6 })}`;
const bitstreamSourceBucket = `bucket-${cryptoRandomString({ length: 6 })}`;

const s3EventFactory = (bucket: string, key: string) => ({
  Records: [
    {
      s3: {
        bucket: {
          name: bucket,
        },
        object: {
          key,
        },
      },
    },
  ],
});

jest.mock('../../lib/lambda-client', () => ({
  invoke: jest.fn(),
}));

describe('bitstreams-downloader.handler', () => {
  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('localhost');

    await s3Utils.createBucket(dspaceItemBucket);
    await s3Utils.createBucket(bitstreamSourceBucket);
  });

  beforeEach(() => {
    nock.cleanAll();

    process.env['DSPACE_ENDPOINT'] = 'https://dspace.test.com';
    process.env['DOCUMENT_BINARY_BUCKET'] = bitstreamSourceBucket;
    process.env['INDEXER_FUNCTION_NAME'] = 'obp-test-indexer-function';
  });

  afterAll(async () => {
    await s3Utils.deleteBucket(dspaceItemBucket, true);
    await s3Utils.deleteBucket(bitstreamSourceBucket, true);

    nock.enableNetConnect();
  });

  test('should upload the PDF bitstream from a DSpace item to S3', async () => {
    const uuid = randomUUID();

    nock('https://dspace.test.com')
      .get('/rest/abc/bitstreams/pdf')
      .reply(200, 'Mock bitstream.');

    await s3Utils.putJson(
      new s3Utils.S3ObjectLocation(dspaceItemBucket, `${uuid}.json`),
      {
        uuid,
        handle: 'handle/abc',
        lastModified: '2021-11-15 11:30:57.109',
        metadata: [],
        bitstreams: [
          {
            bundleName: 'ORIGINAL',
            mimeType: 'application/pdf',
            retrieveLink: '/rest/abc/bitstreams/pdf',
            checkSum: {
              value: 'abc',
            },
          },
          {
            bundleName: 'ORIGINAL',
            mimeType: 'image/jpg',
            retrieveLink: '/rest/abc/bitstreams/jpg',
            checkSum: {
              value: 'abc',
            },
          },
        ],
      }
    );

    const event = s3EventFactory(dspaceItemBucket, `${uuid}.json`);

    await handler(event);

    const result = await s3Utils.getObjectText(
      new s3Utils.S3ObjectLocation(bitstreamSourceBucket, `${uuid}.pdf`)
    );

    expect(result).toEqual('Mock bitstream.');
  });

  test('should directly invoke indexer function if there is no bitstream PDF', async () => {
    const uuid = randomUUID();

    await s3Utils.putJson(
      new s3Utils.S3ObjectLocation(dspaceItemBucket, `${uuid}.json`),
      {
        uuid,
        handle: 'handle/abc',
        lastModified: '2021-11-15 11:30:57.109',
        metadata: [],
        bitstreams: [
          {
            bundleName: 'ORIGINAL',
            mimeType: 'image/jpg',
            retrieveLink: '/rest/abc/bitstreams/jpg',
            checkSum: {
              value: 'abc',
            },
          },
        ],
      }
    );

    const event = s3EventFactory(dspaceItemBucket, `${uuid}.json`);

    await handler(event);

    expect(lambdaClient.invoke).toHaveBeenCalledTimes(1);
    expect(lambdaClient.invoke).toHaveBeenCalledWith(
      'obp-test-indexer-function',
      'Event',
      { uuid }
    );
  });
});