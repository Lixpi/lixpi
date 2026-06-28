The Responses API supports extending model capabilities through function calling, addressing limitations of large models in handling real\-time information and complex workflow orchestration, and enabling more precise and efficient interactions and applications.

<span id="07456946"></span>
## Quick start

The examples below demonstrate how to use function calling to enable the model to call external functions.


<Tabs>
<Tab zoneid="G0yQ6Ie7qc" title="Curl">
<TabTitle>Curl</TabTitle>

**First round request: Trigger tool calling**

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "store": true,
    "input": [
        {
            "type": "message",
            "role": "user",
            "content": "Query the weather in London today"
        }
    ],
    "tools": [
        {
            "type": "function",
            "name": "get_weather",
            "description": "Query weather (including temperature and weather conditions) based on the city name",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City name, e.g., London, New York"
                    }
                },
                "required": ["location"]
            }
        }
    ]
  }'
```


**First round response: Return function_call instruction**

The model will return the tool invocation instruction, with key fields `call_id` (for correlating subsequent results) and `arguments` (invocation parameters):

```JSON
{
    "created_at": 1756980000,
    "id": "resp_02175698000123456789abcdef0123",  # previous_response_id
    "model": "seed-2-0-lite-260228",
    "object": "response",
    "output": [
        {
            "arguments": "{\\"location\\":\\"London\\"}",  # Parameters automatically extracted by the model
            "call_id": "call_abc123def456ghi789jkl0",  # Unique invocation ID for result correlation
            "name": "get_weather",
            "type": "function_call",
            "id": "fc_02175698000abcdef0123456789gh",
            "status": "completed"
        }
    ],
    "status": "completed",
    "store": true,
    "expire_at": 1757239200
}
```


**Execute tool: Get weather results**

The developer calls the actual weather tool (such as a third\-party weather API) according to `arguments`, assuming the returned result is:

```JSON
{
    "city": "London",
    "date": "2025-10-13",
    "temperature": "11-16℃",
    "condition": "Cloudy with chance of light rain",
    "wind": "Northeasterly, 10-15 km/h (Gentle breeze)"
}
```


**Second round request: Return result and generate final response**

Pass in the `response_id` from the previous round and the tool result, and the model will generate a natural language answer:

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "previous_response_id": "resp_02175698000123456789abcdef0123",  # Associate with the previous request
    "input": [
        {
            "type": "function_call_output",  # Return tool results
            "call_id": "call_abc123def456ghi789jkl0",   #  Consistent with the call_id of the instruction
            "output": "{\\"city\\":\\"London\\",\\"date\\":\\"2025-10-13\\",\\"temperature\\":\\"11-16℃\\",\\"condition\\":\\"Cloudy with chance of light rain\\",\\"wind\\":\\"Northeasterly, 10-15 km/h (Gentle breeze)\\"}"
        }
    ]
  }'
```


**Second round response: Generate final answer**

The model combines the tool result and returns a natural language response:

```PowerShell
{
   "created_at":1774843005,
   "id":"resp_0217748430054462ef693f353e4fada74e089bb6c721704fc74ac",
   "max_output_tokens":32768,
   "model":"seed-2-0-lite-260228",
   "object":"response",
   "output":[
      {
         "id":"rs_02177484300597700000000000000000000ffffc0a899dfa33688",
         "type":"reasoning",
         "summary":[
            {
               "type":"summary_text",
               "text":"Got the tool response, now I need to present the weather for London today clearly to the user. Let's structure it nicely. First state it's today's weather (the date is 2025-10-13), then the conditions, temperature range, wind. Let's make it natural. Something like: Here is the weather in London today (2025-10-13):\\n- Overall condition: Cloudy with a chance of light rain\\n- Temperature range: 11-16℃\\n- Wind: Northeasterly, 10-15 km/h, which is a gentle breeze.\\n\\nThat's clear and covers all the info from the tool. Perfect."
            }
         ],
         "status":"completed"
      },
      {
         "type":"message",
         "role":"assistant",
         "content":[
            {
               "type":"output_text",
               "text":"Here is the weather in London today (2025-10-13):\\n- Overall condition: Cloudy with a chance of light rain\\n- Temperature range: 11-16℃\\n- Wind: Northeasterly at 10-15 km/h, a gentle breeze"
            }
         ],
         "status":"completed",
         "id":"msg_02177484300733600000000000000000000ffffc0a899df3e27bf"
      }
   ],
   "previous_response_id":"resp_02175698000123456789abcdef0123",
   "service_tier":"default",
   "status":"completed",
   "usage":{
      "input_tokens":252,
      "output_tokens":216,
      "total_tokens":468,
      "input_tokens_details":{
         "cached_tokens":0
      },
      "output_tokens_details":{
         "reasoning_tokens":151
      }
   },
   "caching":{
      "type":"disabled"
   },
   "store":true,
   "expire_at":1775102205
}
```



</Tab>
<Tab zoneid="l6cuzNLiaq" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark
import json

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')
client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Define the tool (weather query tool)
weather_tool = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Query weather (including temperature and weather conditions) based on the city name",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, e.g., London, New York"
                }
            },
            "required": ["location"]
        }
    }
]

# ------------------- First Round Request: Trigger Tool Call -------------------
print("=== First Round Request: Trigger Tool Call ===")
first_response = client.responses.create(
    model="seed-2-0-lite-260228",
    store=True,
    input=[
        {
            "type": "message",
            "role": "user",
            "content": "Query the weather in London today"
        }
    ],
    tools=weather_tool
)
# Extract key information (previous_response_id, call_id, arguments)
previous_response_id = first_response.id
function_call = next(
    item for item in first_response.output if item.type == "function_call"
)
call_id = function_call.call_id
call_arguments = function_call.arguments
print(f"First Round Response ID: {previous_response_id}")
print(f"Tool Call ID: {call_id}")
print(f"Call Parameters: {call_arguments}")

# ------------------- Simulate Tool Execution: Get Weather Results -------------------
print("=== Simulate Tool Execution: Get Weather Results ===")
# In real scenarios, call a third-party weather API here; we use mock data instead.
tool_output = {
    "city": "London",
    "date": "2025-10-13",
    "temperature": "11-16℃",
    "condition": "Cloudy with chance of light rain",
    "wind": "Northeasterly, 10-15 km/h (Gentle breeze)"
}
print(f"Tool Return Result: {tool_output}")

# ------------------- Second Round Request: Return Result and Generate Final Response -------------------
print("=== Second Round Request: Return Result and Generate Final Response ===")
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=previous_response_id,
    input=[
        {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(tool_output, ensure_ascii=False)
        }
    ]
)
# Extract and print the final answer
final_answer = next(
    item for item in second_response.output if item.type == "message"
)
print("=== Final Answer  ===")
print(final_answer.content[0].text)
```



</Tab>
<Tab zoneid="EZI1HmTi5x" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()
    des := "Query weather (including temperature and weather conditions) based on the city name"
    tools := []*responses.ResponsesTool{
        {
            Union: &responses.ResponsesTool_ToolFunction{
                ToolFunction: &responses.ToolFunction{
                    Name:        "get_weather",
                    Type:        responses.ToolType_function,
                    Description: &des,
                    Parameters:  &responses.Bytes{Value: []byte(`{"type":"object","properties":{"location":{"type":"string","description":"City name, e.g., London, New York"}},"required":["location"]}`)},
                },
            },
        },
    }
    store := true
    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Store: &store,
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_EasyMessage{
                        EasyMessage: &responses.ItemEasyMessage{
                            Role:    responses.MessageRole_user,
                            Type:    responses.ItemType_message.Enum(),
                            Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "Query the weather in London today"}},
                        },
                    },
                }}},
            },
        },
        Tools: tools,
    })
    if err != nil {
        fmt.Printf("response error: %v", err)
        return
    }
    fmt.Println("===First Round Request: Trigger Tool Call=====")
    fmt.Println(resp)
    // Extract key information (previous_response_id, call_id, arguments)
    previous_response_id := resp.Id
    function_call := resp.Output[len(resp.Output)-1].GetFunctionToolCall()
    call_id := function_call.CallId
    call_arguments := function_call.Arguments
    fmt.Println("id", previous_response_id)
    fmt.Println("call_id", call_id)
    fmt.Println("call_arguments", call_arguments)
    fmt.Println("=== Simulate Tool Execution: Get Weather Results ===")
    // In real scenarios, call a third-party weather API here; we use mock data instead.
    tool_output := map[string]string{
        "city": "London",
        "date": "2025-10-13",
        "temperature": "11-16℃",
        "condition": "Cloudy with chance of light rain",
        "wind": "Northeasterly, 10-15 km/h (Gentle breeze)",
    }
    json_output, json_err := json.Marshal(tool_output)
    if json_err != nil {
        fmt.Printf("json marshal error: %v", json_err)
        return
    }
    fmt.Println("Tool Return Result: ", tool_output)
    fmt.Println("=== Second Round Request: Return Result and Generate Final Response ====")

    message := &responses.ResponsesInput{
        Union: &responses.ResponsesInput_ListValue{
            ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                {
                    Union: &responses.InputItem_FunctionToolCallOutput{
                        FunctionToolCallOutput: &responses.ItemFunctionToolCallOutput{
                            CallId: call_id,
                            Output: string(json_output),
                            Type:   responses.ItemType_function_call_output,
                        },
                    },
                },
            }},
        },
    }
    second_resp, second_err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model:              "seed-2-0-lite-260228",
        PreviousResponseId: &previous_response_id,
        Input:              message,
    })
    if second_err != nil {
        fmt.Printf("response error: %v", second_err)
        return
    }
    fmt.Println(second_resp)
}
```



</Tab>
<Tab zoneid="i434GRzG0j" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.byteplus.ark.runtime.model.responses.item.*;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;
import com.byteplus.ark.runtime.model.responses.tool.ResponsesTool;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.byteplus.ark.runtime.model.responses.tool.ToolFunction;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

public class demo {
    public static ObjectMapper om = new ObjectMapper();
    public static List<ResponsesTool> buildTools() {
        JsonNode params = om.createObjectNode()
                .put("type", "object")
                .set("properties", om.createObjectNode()
                        .set("location", om.createObjectNode()
                                .put("type", "string")
                                .put("description", "City name, e.g., London, New York")));

        ToolFunction t = ToolFunction.builder()
                .name("get_weather")
                .description("Query weather (including temperature and weather conditions) based on the city name")
                .parameters(params)
                .build();

        return Arrays.asList(t);
    }
    public static void main(String[] args) throws JsonProcessingException {
        String apiKey = System.getenv("ARK_API_KEY");

        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();
        System.out.println("=== First Round Request: Trigger Tool Call ===");
        CreateResponsesRequest req = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .store(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemText.builder().text("Query the weather in London today").build())
                                        .build()
                        ).build()
                ).build())
                .tools(buildTools())
                .build();
        ResponseObject resp = arkService.createResponse(req);
        System.out.println(resp);
        // Extract key information (previous_response_id, call_id, arguments)
        String previousId = resp.getId();
        BaseItem targetCall = null;
        for(BaseItem item : resp.getOutput()) {
            if ("function_call".equals(item.getType())) {
                targetCall = item;
                break;
            }
        }
        ObjectMapper objectMapper = new ObjectMapper();
        String jsonStr = objectMapper.writeValueAsString(targetCall);
        ItemFunctionToolCall functionCall = objectMapper.readValue(jsonStr, ItemFunctionToolCall.class);
        String callId = functionCall.getCallId();
        String callArguments = functionCall.getArguments();
        System.out.println("First Round Response ID:" + previousId);
        System.out.println("Tool Call ID:" + callId);
        System.out.println("Call Parameters:" + callArguments);

        System.out.println("=== Simulate Tool Execution: Get Weather Results  ===");
        Map<String, String> toolOutput = new HashMap<String, String>() {{
            put("city", "Beijing");
            put("date", "2025-10-13");
            put("temperature", "11-16℃");
            put("condition", "Cloudy with chance of light rain");
            put("wind", "Northeasterly, 10-15 km/h (Gentle breeze)");
        }};

        System.out.println(toolOutput);

        System.out.println("=== Second Round Request: Return Result and Generate Final Response ===");
        CreateResponsesRequest secondReq = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .previousResponseId(previousId)
                .input(ResponsesInput.builder()
                        .addListItem(ItemFunctionToolCallOutput.builder().callId(callId).output(objectMapper.writeValueAsString(toolOutput)).build())
                    .build())
                .tools(buildTools())
                .build();
        ResponseObject secondResp = arkService.createResponse(secondReq);
        System.out.println("=== Final Answer ===");
        System.out.println(secondResp);
        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="XImhXWBjNC" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI
import json

# Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
api_key = os.getenv('ARK_API_KEY')
client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

# Define the tool (weather query tool)
weather_tool = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Query weather (including temperature and weather conditions) based on the city name",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, e.g., London, New York"
                }
            },
            "required": ["location"]
        }
    }
]

# ------------------- First Round Request: Trigger Tool Call -------------------
print("=== First Round Request: Trigger Tool Call ===")
first_response = client.responses.create(
    model="seed-2-0-lite-260228",
    store=True,
    input=[
        {
            "type": "message",
            "role": "user",
            "content": "Query the weather in London today"
        }
    ],
    tools=weather_tool
)
# Extract key information (previous_response_id, call_id, arguments)
previous_response_id = first_response.id
function_call = next(
    item for item in first_response.output if item.type == "function_call"
)
call_id = function_call.call_id
call_arguments = function_call.arguments
print(f"First Round Response ID: {previous_response_id}")
print(f"Tool Call ID: {call_id}")
print(f"Call Parameters: {call_arguments}")

# ------------------- Simulate Tool Execution: Get Weather Results -------------------
print("=== Simulate Tool Execution: Get Weather Results ===")
tool_output = {
    "city": "London",
    "date": "2025-10-13",
    "temperature": "11-16℃",
    "condition": "Cloudy with chance of light rain",
    "wind": "Northeasterly, 10-15 km/h (Gentle breeze)"
}
print(f"Tool Return Result: {tool_output}")

# ------------------- Second Round Request: Return Result and Generate Final Response-------------------
print("=== Second Round Request: Return Result and Generate Final Response ===")
second_response = client.responses.create(
    model="seed-2-0-lite-260228",
    previous_response_id=previous_response_id,
    input=[
        {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(tool_output, ensure_ascii=False)
        }
    ]
)
# Extract and print the final answer
final_answer = next(
    item for item in second_response.output if item.type == "message"
)
print("=== Final Answer ===")
print(final_answer.content[0].text)
```



</Tab>
</Tabs>


<span id="633a560f"></span>
## Supported tools

<span id="2f52557d"></span>
### Function calling

When creating model responses, you can use `tools` to define custom functions. The model accesses specific data or functionality that cannot be directly used within the model by calling custom function code.

For more information, please refer to [Function calling](https://docs.byteplus.com/en/docs/ModelArk/1262342).

<span id="f8cd1de5"></span>
### Cloud deployment MCP / remote MCP

Connect the models with MCP (Model Context Protocol) tools. Suitable for complex tasks (such as multi\-step data query and analysis) scenarios. For detailed tutorials, see [Cloud-deployed MCP / remote MCP](https://docs.byteplus.com/history/folder/folder-untitled-2/translation-archive-cloud-deployment-mcp/translation-archive-cloud-deployment-mcp-remote-mcp.md).



