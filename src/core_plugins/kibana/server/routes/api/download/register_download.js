import _ from 'lodash';

export function registerDownload(server) {
  // We can use this method, since we have set the require in the index.js to
  // elasticsearch. So we can access the elasticsearch plugins safely here.

  let queryCounter = 0;

  // TODO: timeout or last n-items
  const queryCache = {};

  server.route({
    path: '/elasticsearch_status/hello',
    method: 'POST',
    handler(req, reply) {
      queryCounter += 1;
      queryCache[queryCounter] = req.payload.data;
      reply('' + queryCounter);
    }
  });

  server.route({
    path: '/elasticsearch_status/hello/{queryId}',
    method: 'GET',
    handler(req, reply) {
      const { callWithRequest } = server.plugins.elasticsearch.getCluster('data');
      const Readable = require('stream').Readable;
      const outputStream = new Readable ();
      outputStream._read = function (size) {
      };
      const paramsStr = queryCache[req.params.queryId];
      const params = JSON.parse(paramsStr);
      const searchRequest = {
        index: '*',
        ignore_unavailable: true,
        preference: 1490194364695,
        size: 2000,
        scroll: '45s',
        body : {
          sort:[{ '@timestamp':{ order:'desc',unmapped_type:'boolean' } }],
          'query':{
            'bool':{
              'must':[
                {
                  'query_string':{
                    'query': params.query.query_string.query,
                    'analyze_wildcard':true
                  }
                },
                {
                  'range':{
                    '@timestamp':{
                      'gte':params.range.min,
                      'lte':params.range.max,
                      'format':'epoch_millis'
                    }
                  }
                }
              ]
            }
          }
        }
      };

      const writeHits = function (hits, outputStream) {
        let hitEntry = '';
        for (let i = 0; i < hits.length; i++) {
          hitEntry = hits[i];
          outputStream.push('- - - - - - - - - - - - - - - - - - - - - - - - - - - - - -\r\n');
          outputStream.push('host:' + hitEntry._source.host + '\r\n');
          outputStream.push('path:' + hitEntry._source.path + '\r\n');
          outputStream.push(hitEntry._source.message + '\r\n');
        }
      };

      callWithRequest(req, 'search', searchRequest).then(function (resp) {
        writeHits(resp.hits.hits, outputStream);
        const nFunc = function (scrollId) {
          const nextRequest = { 'scroll' : '1m', 'scroll_id' : scrollId };
          callWithRequest(req, 'scroll', nextRequest).then(function (respScroll) {
            if (respScroll.hits.hits.length > 0) {
              writeHits(respScroll.hits.hits, outputStream);
              nFunc(respScroll._scroll_id);
            } else {
              outputStream.push(null);
            }
          });
        };
        nFunc(resp._scroll_id);
      });
      reply(outputStream).header('Content-Disposition', 'attachment; filename=query-result.log;');
    }
  });
}
