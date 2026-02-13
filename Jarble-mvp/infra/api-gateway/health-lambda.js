// jarble-health Lambda
// Returns health status for API Gateway

exports.handler = async (event) => {
  console.log('Health check called:', JSON.stringify(event, null, 2));
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok: true,
      service: 'jarble-api',
      timestamp: new Date().toISOString(),
      region: process.env.AWS_REGION,
    }),
  };
};
