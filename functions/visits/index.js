import { DynamoDB } from "aws-sdk";

export async function handler(event) {
  // console.info("EVENT:" + JSON.stringify(event));

  const dynamodb = new DynamoDB.DocumentClient({
    region: "us-east-1",
  });
  // TODO: I'm supposed to be grabbing this from the body, not the request context.
  // var body = JSON.parse(event.body);
  // var ip = body.ip;
  // var userAgent = body.userAgent;
  // TODO: validate that the host we're receiving is api.free.land
  var ip = event.requestContext.identity.sourceIp;
  var userAgent = event.requestContext.identity.userAgent;
  const id = ip + "#" + userAgent;
  const now = Math.floor(Date.now() / 1000);

  const tableName = "visits";

  const headers = {
    "Access-Control-Allow-Origin": "*", // Adjust this to restrict access to specific origins if needed
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: headers,
      body: "",
    };
  }

  if (event.httpMethod == "GET") {
    try {
      // Scan the table to get all items
      const paramsScan = {
        TableName: tableName,
      };
      const result = await dynamodb.scan(paramsScan).promise();

      // Sum the counts of all items
      const totalCount = result.Items.reduce(
        (sum, item) => sum + (item.count || 0),
        0,
      );

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ visits: totalCount }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ status: "get visits failed: " + error }),
      };
    }
  }

  if (event.httpMethod == "POST") {
    try {
      // Check if entry exists
      const paramsGet = {
        TableName: tableName,
        Key: { id: id },
      };
      const result = await dynamodb.get(paramsGet).promise();

      let count = 1;
      if (result.Item) {
        // Check if the last visit was within the 5-minute window
        if (now - result.Item.lastVisit < 300) {
          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({ status: "recent visit recorded" }),
          };
        }
        count = result.Item.count + 1;
      }

      // Update or create entry
      const paramsPut = {
        TableName: tableName,
        Item: {
          id: id,
          ip: ip,
          ua: userAgent,
          lastVisit: now,
          count: count,
        },
      };
      await dynamodb.put(paramsPut).promise();

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({ status: "recorded new visit" }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ status: "record visit failed: " + error }),
      };
    }
  }
}
