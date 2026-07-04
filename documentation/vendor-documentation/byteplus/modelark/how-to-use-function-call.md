Function calling is a key feature that connects large language models (LLMs) with external tools and APIs. Acting as a "translator" between natural language and information interfaces, it can intelligently convert users' natural language requests into calls to specific tools or APIs, so as to efficiently meet users' specific needs.

<span id="7c1b0bc0"></span>
# Function overview


* **Core value**: Enables seamless connection between LLMs and external tools, allowing LLMs to handle complex tasks such as real\-time data query and task execution with the help of external tools, and to create value in real production.

* **How it works**: Developers describe the function and definition of tools to the model in natural language, and the model independently judges whether a function call is required during the conversation. When a call is required, the model will return the eligible tool function and input parameters. The developer is responsible for actually calling the function and feeding the result back to the model, which then summarizes based on the result or continues to plan subtasks.


<span id="8f125d19"></span>
# Use cases

Function calling is helpful in the following cases that require collaboration between LLMs and external tools:


<span aceTableMode="list" aceTableWidth="1,2,2,3"></span>
|**Case** |**Requirements** |**Value** |**Application** |
|---|---|---|---|
|Real\-time data interaction |Requires LLMs and external tools to collaboratively process dynamic information |Meets dynamic information query requirements |Queries real\-time data of weather, stocks, flights, database, and API. |
|Task automation |Operation completed with a single function call |Improves operation efficiency. |Automatically sends emails/messages, or executes device control commands (such as smart home switch control). |
|Complex orchestration |Sequential and parallel calls of multiple tools |Transfers parameters among tools, and manages subtask dependencies. |Queries the weather forecast and then sends messages. |
|Smart system integration |Deeply coupled with business systems |Implements intelligent system linkage |Multidevice linkage control for smart cockpits, enterprise\-level Bot workflows (such as Lark meeting creation → group management → task generation) |


<span id="3b0e85b6"></span>
## Working principle diagram

<span>![图片](https://asset.ark-doc-resources.com/flowcharts/tool-calling/function-calling-tt-01.svg) </span>

<span id="3c34028e"></span>
## Typical example

User: What's the weather like in London today? What clothes should I wear?

Model reasoning:


1. I need to call the weather query tool to get real\-time data (location=London, unit=Celsius).

2. Weather information includes temperature and weather conditions (sunny/rainy, etc.), and clothing suggestions need to be given based on the data.


Function calling result:

Today in London it is sunny, with a temperature of 18\-25℃, north wind of level 3, and humidity of 45%.

Model response:

Today in London it is sunny, with a temperature of 18\-25℃. It is recommended to wear a thin long\-sleeved shirt or short\-sleeved T\-shirt, paired with a light jacket to cope with the temperature difference between morning and evening.

<span id="8302bfc4"></span>
# Procedure

<span id="4ddc710a"></span>
## Steps

<span id="40ba91b2"></span>
### Step 1: Define functions

Describe available functions to the model through the `tools` parameter. JSON format is supported, including information such as function name, description, and parameter definition.

<span id="4ed881d7"></span>
#### **Define tool functions**

```Python
def get_current_weather(location, unit="Celsius"):
    # Logic for actually calling the weather query API
    # This is an example that returns simulated weather data
    return f"{location} is sunny today, with a temperature of 25 {unit}."
```



* A tool function named `get_current_weather` is defined, which is used to get weather information for a specified location.

   * `location`: Required parameter, indicating the location.

   * `unit`: Optional parameter, default value is `Celsius`, indicating the temperature unit.

* The function currently only returns simulated weather data. In actual applications, you need to call a real weather query API.


<span id="85fca8e3"></span>
#### **Define tools parameter**

```Python
{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "Gets weather information for a specified location. It supports two units: Celsius and Fahrenheit",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "Location information, such as London, New York"
        },
        "unit": {
          "type": "string",
          "enum": ["Celsius", "Fahrenheit"],
          "description": "Temperature unit. Valid values are Celsius or Fahrenheit."
        }
      },
      "required": ["location"]
    }
  }
}
```


For more specifications and precautions related to function construction, see [Appendix: Tool function parameter construction specification](https://docs.byteplus.com/en/docs/ModelArk/1262342#46345c43).

<span id="a4a1c77c"></span>
### Step 2: Send a model request

Include the user's question and function definition in the request, and the model will return the function that needs to be called and its parameters according to the requirements.

```Python
import os
from byteplussdkarkruntime import Ark
 
# Obtain your API key from the environment variable. 
api_key = os.getenv('ARK_API_KEY')
# Initialize Ark client
client = Ark(
    api_key = api_key,
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3"
)

messages = [
    {"role": "user", "content": "What's the weather like today in London?"}
]
tools = [
    {
        # See the tools defined in Step 1
    }
]
# Send model request
completion = client.chat.completions.create(
    model="seed-2-0-lite-260228",
    messages=messages,
    tools=tools
)
```


<span id="cafa9d6f"></span>
### Step 3: Call external functions

According to the function name and parameters returned by the model, call the corresponding external function or API to get the function execution result.

```Python
# Parse the function calling information returned by the model
tool_call = completion.choices[0].message.tool_calls[0]
# Function name
tool_name = tool_call.function.name
# If it is determined that the weather query function needs to be called, run the weather query function
if tool_name == "get_current_weather":
    # Extracted user parameters
    arguments = json.loads(tool_call.function.arguments)
    # Call the function
    tool_result = get_current_weather(**arguments)
```



* `tool_calls`: Gets the list of tools called by the model.

* If the tool function name is `get_current_weather`, parse the parameters of the function and call the `get_current_weather` function to get the tool execution result.


<span id="81b61333"></span>
### Step 4: Feed back the result and get the final reply

Feed the tool execution result back to the model in the form of a message with `role=tool`, and the model generates the final reply based on the result.

```Python
messages.append(completion.choices[0].message.model_dump())
messages.append({
    "role": "tool",
    "tool_call_id": tool_call.id,
    "content": tool_result
})

# Call the model again to get the final reply
final_completion = client.chat.completions.create(
    model="seed-2-0-lite-260228",
    messages=messages
)

print(final_completion.choices[0].message.content)
```


<span id="af108c86"></span>
## Complete code sample


<Tabs>
<Tab zoneid="q0syFSclMu" title="Python - ModelArk SDK">
<TabTitle>Python - ModelArk SDK</TabTitle>

```Python
from byteplussdkarkruntime import Ark
from byteplussdkarkruntime.types.chat import ChatCompletion
import json
client = Ark()
messages = [
    {"role": "user", "content": "What's the weather like today in London and New York?"}
]
# Step 1: Define tools
tools = [{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "Get weather information for the specified location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "Location information, such as London, New York"
        },
        "unit": {
          "type": "string",
          "enum": ["Celsius", "Fahrenheit"],
          "description": "Temperature unit"
        }
      },
      "required": ["location"]
    }
  }
}]
def get_current_weather(location: str, unit="Celsius"):
    # Logic for actually calling the weather query API
    # This is an example that returns simulated weather data
    return f"{location} is sunny today, with a temperature of 25 {unit}."
while True:
    # Step 2: Send requests to the model. Since the model may still want to make a function call after receiving the tool execution result, multiple requests are required.
    completion: ChatCompletion = client.chat.completions.create(
    model="seed-2-0-lite-260228",
    messages=messages,
    tools=tools
    )
    resp_msg = completion.choices[0].message
    # Display the model's intermediate response
    print(resp_msg.content)
    if completion.choices[0].finish_reason != "tool_calls":
        # The model generates the final summary and has no intention to call tools
        break
    messages.append(completion.choices[0].message.model_dump())
    tool_calls = completion.choices[0].message.tool_calls
    for tool_call in tool_calls:
        tool_name = tool_call.function.name
        if tool_name == "get_current_weather":
            # Step 3: Call external tools
            args = json.loads(tool_call.function.arguments)
            tool_result = get_current_weather(**args)
            # Step 4: Feed the tool result back and get the model's summary response
            messages.append(
                {"role": "tool", "content": tool_result, "tool_call_id": tool_call.id}
            )
```



</Tab>
<Tab zoneid="cHiOoviozD" title="Python - Arkitect SDK">
<TabTitle>Python - Arkitect SDK</TabTitle>

```Python
from arkitect.core.component.context.context import Context
from enum import Enum
import asyncio
from pydantic import Field
def get_current_weather(location: str = Field(description="Location information, e.g. London, New York"), unit: str=Field(description="Temperature unit. Valid values are Celsius or Fahrenheit")):
    """
    Get weather information for the specified location
    """
    return f"{location} is sunny today, with a temperature of 25 {unit}."
async def chat_with_tool():
    ctx = Context(
            model="seed-2-0-lite-260228",
            tools=[
                get_current_weather
            ],  # Pass all your Python methods as tools directly in this list. The tool descriptions will be automatically sent to the model for inference, and tool execution will be performed automatically in ctx.completions.create
        )
    await ctx.init()
    completion = await ctx.completions.create(messages=[
        {"role":"user","content":"What's the weather like today in London and New York?"}
    ],stream =False)
    return completion
completion = asyncio.run(chat_with_tool())
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="FDb6a3LDeW" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.byteplus.ark.runtime.model.completion.chat.*;
import com.byteplus.ark.runtime.service.ArkService;

import java.util.*;

public class VolcEngineFunctionCallChat {

    // Class for parsing parameters of the get_current_weather function
    public static class WeatherArgs {
        @JsonProperty("location")
        private String location;

        @JsonProperty("unit")
        private String unit;

        // Jackson requires a default constructor
        public WeatherArgs() {
        }

        public String getLocation() {
            return location;
        }

        public void setLocation(String location) {
            this.location = location;
        }

        public String getUnit() {
            return unit;
        }

        public void setUnit(String unit) {
            this.unit = unit;
        }
    }

    // Class for defining the parameter schema of tool functions (similar to the parameters dictionary structure in Python)
    public static class FunctionParameterSchema {
        public String type;
        public Map<String, Object> properties;
        public List<String> required;

        public FunctionParameterSchema(String type, Map<String, Object> properties, List<String> required) {
            this.type = type;
            this.properties = properties;
            this.required = required;
        }

        public String getType() {
            return type;
        }

        public Map<String, Object> getProperties() {
            return properties;
        }

        public List<String> getRequired() {
            return required;
        }
    }

    private static final ObjectMapper objectMapper = new ObjectMapper();

    // Tool function implementation: get_current_weather
    public static String getCurrentWeather(String location, String unit) {
        // This should be the logic for actually calling the weather query API
        // This is an example that returns simulated weather data
        String currentUnit = (unit == null || unit.isEmpty()) ? "Celsius" : unit;
        System.out.println(String.format("Calling tool get_current_weather: location=%s, unit=%s", location, currentUnit));
        return String.format("The weather in %s is sunny today, with a temperature of 25 %s.", location, currentUnit);
    }

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");

        if (apiKey == null || apiKey.isEmpty()) {
            System.err.println("Error: ARK_API_KEY environment variable is not set.");
            return;
        }

        ArkService service = ArkService.builder()
                .apiKey(apiKey)
                .build();

        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.builder().role(ChatMessageRole.USER).content("What is the weather like in London and New York today?").build());

        // Step 1: Define tools
        Map<String, Object> locationProperty = new HashMap<>();
        locationProperty.put("type", "string");
        locationProperty.put("description", "Location information of the place, e.g. London, New York");

        Map<String, Object> unitProperty = new HashMap<>();
        unitProperty.put("type", "string");
        unitProperty.put("enum", Arrays.asList("Celsius", "Fahrenheit"));
        unitProperty.put("description", "Temperature unit");

        Map<String, Object> schemaProperties = new HashMap<>();
        schemaProperties.put("location", locationProperty);
        schemaProperties.put("unit", unitProperty);

        FunctionParameterSchema functionParams = new FunctionParameterSchema(
                "object",
                schemaProperties,
                Collections.singletonList("location") // 'location' is a required parameter
        );

        List<ChatTool> tools = Collections.singletonList(
                new ChatTool(
                        "function", // Tool type
                        new ChatFunction.Builder()
                                .name("get_current_weather")
                                .description("Get weather information for the specified location")
                                .parameters(functionParams) // Parameter schema of the tool function
                                .build()));

        String modelId = "seed-2-0-lite-260228";

        while (true) {
            // Step 2: Send a request to the model
            ChatCompletionRequest request = ChatCompletionRequest.builder()
                    .model(modelId)
                    .messages(messages)
                    .tools(tools)
                    .build();

            ChatCompletionResult completionResult;
            try {
                completionResult = service.createChatCompletion(request);
            } catch (Exception e) {
                System.err.println("An error occurred while calling the Ark API: " + e.getMessage());
                e.printStackTrace();
                break;
            }

            if (completionResult == null || completionResult.getChoices() == null
|| completionResult.getChoices().isEmpty()) {
                System.err.println("Empty or invalid response received from the model.");
                break;
            }

            ChatCompletionChoice choice = completionResult.getChoices().get(0);
            ChatMessage responseMessage = choice.getMessage();

            // Display the model's intermediate response
            System.out.println("Model response: " + responseMessage.stringContent());

            // Add the model's response (including function calling requests) to the message history
            messages.add(responseMessage);
            if (choice.getFinishReason() == null || !"tool_calls".equalsIgnoreCase(choice.getFinishReason())) {
                // Final summary from the model, no intention to call tools, or other termination reasons such as an error occurred
                break;
            }

            List<ChatToolCall> toolCalls = responseMessage.getToolCalls();
            if (toolCalls == null || toolCalls.isEmpty()) {
                // If finish_reason is "tool_calls" but toolCalls is empty, this may be abnormal.
                System.err.println("Warning: Finish reason is 'tool_calls' but no tool_calls found in the message.");
                break;
            }

            for (ChatToolCall toolCall : toolCalls) {
                String toolName = toolCall.getFunction().getName();
                if ("get_current_weather".equals(toolName)) {
                    // Step 3: Call external tool
                    String argumentsJson = toolCall.getFunction().getArguments();
                    WeatherArgs tool_args;
                    try {
                        tool_args = objectMapper.readValue(argumentsJson, WeatherArgs.class);
                    } catch (JsonProcessingException e) {
                        System.err.println("Error parsing get_current_weather parameters: " + argumentsJson + " - " + e.getMessage());
                        // Feed back the error message as the tool result
                        messages.add(ChatMessage.builder()
                                .role(ChatMessageRole.TOOL)
                                .content("Error parsing parameters: " + e.getMessage())
                                .toolCallId(toolCall.getId())
                                .build());
                        continue;
                    }

                    String toolResult = getCurrentWeather(tool_args.getLocation(), tool_args.getUnit());
                    System.out.println("Tool execution result (" + toolCall.getId() + "): " + toolResult);

                    // Step 4: Feed back the tool result and get the model summary response
                    messages.add(ChatMessage.builder()
                            .role(ChatMessageRole.TOOL)
                            .content(toolResult)
                            .toolCallId(toolCall.getId()) // Associate function calling ID
                            .build());
                }
            }
        }

        service.shutdownExecutor();
        System.out.println("Session ended.");
    }
}
```



</Tab>
<Tab zoneid="XvtjZ5ZPte" title="Golang">
<TabTitle>Golang</TabTitle>

```Go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

type WeatherArgs struct {
    Location string `json:"location"`
    Unit     string `json:"unit,omitempty"` // omitempty allows unit to be optional
}

// Target tool
func getCurrentWeather(location string, unit string) string {
    if unit == "" {
        unit = "Celsius" // Default unit
    }
    // This is an example which returns simulated weather data
    return fmt.Sprintf("The weather in %s is sunny today, temperature is 25 %s.", location, unit)
}

func main() {
    // Get API Key from environment variables. Please make sure ARK_API_KEY is set.
    apiKey := os.Getenv("ARK_API_KEY")
    if apiKey == "" {
        fmt.Println("Error: Please set the ARK_API_KEY environment variable.")
        return
    }

    client := arkruntime.NewClientWithApiKey(
        apiKey,
    )

    ctx := context.Background()

    // Initialize message list
    messages := []*model.ChatCompletionMessage{
        {
            Role: model.ChatMessageRoleUser,
            Content: &model.ChatCompletionMessageContent{
                StringValue: volcengine.String("What is the weather like in London and New York today?"),
            },
        },
    }

    // Step 1: Define tools
    tools := []*model.Tool{
        {
            Type: model.ToolTypeFunction,
            Function: &model.FunctionDefinition{
                Name:        "get_current_weather",
                Description: "Get weather information for the specified location",
                Parameters: map[string]interface{}{
                    "type": "object",
                    "properties": map[string]interface{}{
                        "location": map[string]interface{}{
                            "type":        "string",
                            "description": "Location information of the place, such as London, New York",
                        },
                        "unit": map[string]interface{}{
                            "type": "string",
                            "enum": []string{
                                "Celsius",
                                "Fahrenheit",
                            },
                            "description": "Temperature unit",
                        },
                    },
                    "required": []string{"location"},
                },
            },
        },
    }

    for {
        // Step 2: Send a request to the model
        req := model.CreateChatCompletionRequest{
            Model:    "seed-2-0-lite-260228", // Model consistent with the Python code sample
            Messages: messages,
            Tools:    tools,
        }

        resp, err := client.CreateChatCompletion(ctx, req)
        if err != nil {
            fmt.Printf("Model request error: %v\n", err)
            return
        }

        if len(resp.Choices) == 0 {
            fmt.Println("The model did not return any choice.")
            return
        }

        respMsg := resp.Choices[0].Message

        // Display the model's intermediate response (if any)
        if respMsg.Content.StringValue != nil && *respMsg.Content.StringValue != "" {
            fmt.Println("Model reply:", *respMsg.Content.StringValue)
        }

        if resp.Choices[0].FinishReason != model.FinishReasonToolCalls || len(respMsg.ToolCalls) == 0 {
            break
        }

        // Add the model's response (including function calling requests) to the message history
        messages = append(messages, &respMsg)

        for _, toolCall := range respMsg.ToolCalls {
            fmt.Printf("The model attempts to call the tool: %s, ID: %s\n", toolCall.Function.Name, toolCall.ID)
            fmt.Println("  Parameters:", toolCall.Function.Arguments)

            var toolResult string
            if toolCall.Function.Name == "get_current_weather" {
                // Step 3: Call external tool
                var args WeatherArgs
                err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args)
                if err != nil {
                    fmt.Printf("Error parsing tool parameters (%s): %v\n", toolCall.Function.Name, err)
                    toolResult = fmt.Sprintf("Failed to parse parameters: %v", err)
                } else {
                    toolResult = getCurrentWeather(args.Location, args.Unit)
                    fmt.Println("  Tool execution result:", toolResult)
                }

                // Step 4: Feed back the tool result
                messages = append(messages, &model.ChatCompletionMessage{
                    Role:       model.ChatMessageRoleTool,
                    Content:    &model.ChatCompletionMessageContent{StringValue: volcengine.String(toolResult)},
                    ToolCallID: toolCall.ID,
                })
            }
        }
        fmt.Println("--- Next round of conversation ---")
    }
}
```



</Tab>
</Tabs>


<span id="5bff8484"></span>
# Recommended configuration and optimization

<span id="bf74892a"></span>
## Parallel tool calling

You can control whether the model can call multiple tools in parallel through the `parallel_tool_calls` parameter according to your requirements.


* `parallel_tool_calls: true`\*\* (default value)\*\*: The model can return multiple tools to be called in a single request.

* `parallel_tool_calls: false`: For the `seed-1.6` series models, this setting limits the model to return at most one tool to be called.


<span id="fedd0024"></span>
## Prompt design best practices

When designing prompts, follow the following core principles to provide clear, direct, and unambiguous instructions to the model:


1. **Prioritize using code to handle deterministic tasks**: If a task can be efficiently solved through traditional programming, avoid calling large models to improve system efficiency and reduce costs.

2. **Keep input focused**: Only provide the model with information directly related to the current task, and avoid irrelevant content that interferes with the model's judgment.

   
   <span aceTableMode="list" aceTableWidth="2,2,3,3"></span>
   |**Category** |**Problem** |**Before** |**After** |
   |---|---|---|---|
   |Function |Nonstandard naming and description |```Go```<br>```{```<br>```   "type": "function",```<br>```    "function": {```<br>```        "name": "GPT1",```<br>```        "description": "Create event",```<br>```     }```<br>```}```<br> |```Go```<br>```{```<br>```   "type": "function",```<br>```    "function": {```<br>```        "name": "CreateEvent",```<br>```        "description": "When you need to create an event for the user, this tool creates an event and returns the event ID",```<br>```     }```<br>```}```<br> |
   |Parameter |Unnecessary complex formats (or nesting) |```Go```<br>```{```<br>```    "time": {```<br>```        "type": "object",```<br>```        "description": "Event time",```<br>```        "properties": {```<br>```            "timestamp": {```<br>```                "description": "Event time"```<br>```            }```<br>```        }```<br>```    }```<br>```}```<br> |```Go```<br>```{```<br>```    "time": {```<br>```        "type": "string",```<br>```        "description": "Event time",```<br>```    }```<br>```}```<br> |
   ||Parameter with fixed values |```Go```<br>```{```<br>```    "time": {```<br>```        "type": "object",```<br>```        "description": "Event time",```<br>```        "properties": {```<br>```            "timestamp": {```<br>```                "description": "Always pass the fixed value 2024-01-01"```<br>```            }```<br>```        }```<br>```    }```<br>```}```<br> |Since the parameter value is fixed, delete this parameter and handle it with code. |
   |Business process |Unnecessary rounds of LLM calls |System prompt:<br><br>```Go```<br>```You are communicating with user Alan. You need to query the user ID first, then create an event using the ID.```<br> |System prompt:<br><br>```Go```<br>```You are communicating with user Alan (ID=abc123). You can create an event using the ID.```<br> |
   ||Ambiguity |System prompt:<br><br>```Go```<br>```You can look up a user by ID and get the user's event ID.```<br><br><br>The two IDs here are not clear, so the model may mix them up. |System prompt:<br><br>```Go```<br>```Each user has a unique user ID; each event has a corresponding event ID; the two are independent IDs.```<br>```You can look up a user by user ID and get all event IDs of the user.```<br> |
   


<span id="64226200"></span>
## Function calling exception handling

JSON format fault tolerance mechanism: For slightly invalid JSON formats, you can try to use the `json-repair` library for fault tolerance and repair.

```Python
import json_repair

invalid_json = '{"location": "London", "unit": "Celsius"}'
valid_json = json_repair.loads(invalid_json)
```


<span id="51d1256f"></span>
## Requirement clarification

Requirement clarification (confirmation) does not depend on FC, and can be done independently. You can add the following to the system prompt:

```Plain
If the user does not provide enough information to call the function, continue asking questions to ensure that sufficient information is collected.
Before calling the function, you must summarize the user's description, provide the summary to the user, and ask if they need any modifications.
...
```


Add the following to the description of the function:

```Plain
In addition to extracting a and b for function parameters, the user should also be required to provide c, d, e, f and other relevant details.
```


Or add parameter verification logic in the system prompt. When the parameters generated by the model are missing, guide the model to regenerate complete parameters.

```Plain
If the information provided by the user lacks the required parameters for the tool, you need to ask further questions to let the user provide more information.
```


<span id="4ef28c40"></span>
## Streaming output

You can use streaming output to progressively deliver function\-calling information.

```Python
import os
from byteplussdkarkruntime import Ark
# Get ModelArk API Key from environment variables
client = Ark(api_key=os.environ.get("ARK_API_KEY"))
stream = client.chat.completions.create(
    model="seed-2-0-lite-260228",
    messages=[
        {
            "role": "user",
            "content": "Tell me a story, then tell me the weather in London today",
        }
    ],
    tools=[
#         Information about the tool you want to call
        {...}
    ],
    stream=True,
)
final_tool_calls = {}
for chunk in stream:
    if not chunk.choices:
        continue
    print(chunk.choices[0].delta.content, end="")
#     Code adaptation for returning information using the new version of function call capability, assemble the streaming output before returning
    for tool_call in chunk.choices[0].delta.tool_calls or []:
        index = tool_call.index
        if index not in final_tool_calls:
            final_tool_calls[index] = tool_call
        final_tool_calls[index].function.arguments += tool_call.function.arguments

print("Tools: ", final_tool_calls)
```


<span id="7fe521b0"></span>
## Strict mode

Set the `strict` parameter to `true` to enable strict mode. This mode ensures that the model strictly follows the function Schema you define to generate call parameters. To ensure the accuracy and predictability of function calls, we recommend that you always enable strict mode. The following prerequisites must be met to enable strict mode (see ):


1. All parameters defined in `properties` must be declared in the `required` array.

2. In the `parameters` definition of the function, it is recommended to set `"additionalProperties": false`.


If you need to set a parameter to optional, you can add `null` to its `type` definition. For example: `{"type": ["string", "null"]}`.


<Tabs>
<Tab zoneid="QqxzwcJj51" title="Strict mode enabled">
<TabTitle>Strict mode enabled</TabTitle>

```JSON
{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "Gets weather information for a specified location. It supports two units: Celsius and Fahrenheit",
    "strict": true,  // Enable strict mode
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "Location information, such as London, New York"
        },
        "unit": {
          "type": ["string", "null"],       //Different from when not enabled
          "enum": ["Celsius", "Fahrenheit"],
          "description": "Temperature unit. Valid values are Celsius or Fahrenheit."
        }
      },
      "required": ["location", "unit"], //Different from when not enabled
      "additionalProperties": false
    }
  }
}
```



</Tab>
<Tab zoneid="p541ssY1cr" title="Strict mode disabled">
<TabTitle>Strict mode disabled</TabTitle>

```JSON
{
  "type": "function",
  "function": {
    "name": "get_current_weather",
    "description": "Gets weather information for a specified location. It supports two units: Celsius and Fahrenheit",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "Location information, such as London, New York"
        },
        "unit": {
          "type": "string",
          "enum": ["Celsius", "Fahrenheit"],
          "description": "Temperature unit. Valid values are Celsius or Fahrenheit."
        }
      },
      "required": ["location"]
    }
  }
}
```



</Tab>
</Tabs>


<span id="3c71cf43"></span>
## Multi\-turn function calling

When user requirements require multiple calls to tool functions, maintain the conversation history context, process function calls and fill in results round by round.

<span id="9174ac73"></span>
### Example process


1. User query: "Check the weather in London and send the result to Johnson".

2. Round 1: The model calls the `get_current_weather` tool to get the weather in London.

3. Round 2: The model calls the `send_message` tool to send the weather result to Johnson.

4. Round 3: The model summarizes the task completion status and returns the final reply.


<span id="ce94374b"></span>
### Code samples

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Multi\-turn function calling: Refers to the scenario where a user query requires multiple calls to tool functions and the large model to complete, which is a subset of multi\-turn conversations.</div>



<Tabs>
<Tab zoneid="pgdjJwLWik" title="Golang">
<TabTitle>Golang</TabTitle>

```Go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "strings"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
       os.Getenv("ARK_API_KEY"),
       arkruntime.WithBaseUrl("\\${BASE_URL}"),
    )

    fmt.Println("----- function call multiple rounds request -----")
    ctx := context.Background()
    // Step 1: send the conversation and available functions to the model
    req := model.CreateChatCompletionRequest{
       Model: "seed-2-0-lite-260228", // Replace with Model ID
       Messages: []*model.ChatCompletionMessage{
          {
             Role: model.ChatMessageRoleSystem,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("You are an AI assistant"),
             },
          },
          {
             Role: model.ChatMessageRoleUser,
             Content: &model.ChatCompletionMessageContent{
                StringValue: byteplus.String("What's the weather like in New York?"),
             },
          },
       },
       Tools: []*model.Tool{
          {
             Type: model.ToolTypeFunction,
             Function: &model.FunctionDefinition{
                Name:        "get_current_weather",
                Description: "Get the current weather in a given location",
                Parameters: map[string]interface{}{
                   "type": "object",
                   "properties": map[string]interface{}{
                      "location": map[string]interface{}{
                         "type":        "string",
                         "description": "The city and state, e.g. London",
                      },
                      "unit": map[string]interface{}{
                         "type":        "string",
                         "description": "Valid values are Celsius, Fahrenheit",
                      },
                   },
                   "required": []string{
                      "location",
                   },
                },
             },
          },
       },
    }
    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       fmt.Printf("chat error: %v\n", err)
       return
    }
    // extend conversation with assistant's reply
    req.Messages = append(req.Messages, &resp.Choices[0].Message)

    // Step 2: check if the model wanted to call a function.
    // The model can choose to call one or more functions; if so,
    // the content will be a stringified JSON object adhering to
    // your custom schema (note: the model may hallucinate parameters).
    for _, toolCall := range resp.Choices[0].Message.ToolCalls {
       fmt.Println("calling function")
       fmt.Println("    id:", toolCall.ID)
       fmt.Println("    name:", toolCall.Function.Name)
       fmt.Println("    argument:", toolCall.Function.Arguments)
       functionResponse, err := CallAvailableFunctions(toolCall.Function.Name, toolCall.Function.Arguments)
       if err != nil {
          functionResponse = err.Error()
       }
       // extend conversation with function response
       req.Messages = append(req.Messages,
          &model.ChatCompletionMessage{
             Role:       model.ChatMessageRoleTool,
             ToolCallID: toolCall.ID,
             Content: &model.ChatCompletionMessageContent{
                StringValue: &functionResponse,
             },
          },
       )
    }
    // get a new response from the model where it can see the function response
    secondResp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
       fmt.Printf("second chat error: %v\n", err)
       return
    }
    fmt.Println("conversation", MustMarshal(req.Messages))
    fmt.Println("new message", MustMarshal(secondResp.Choices[0].Message))
}
func CallAvailableFunctions(name, arguments string) (string, error) {
    if name == "get_current_weather" {
       params := struct {
          Location string `json:"location"`
          Unit     string `json:"unit"`
       }{}
       if err := json.Unmarshal([]byte(arguments), &params); err != nil {
          return "", fmt.Errorf("failed to parse function call name=%s arguments=%s", name, arguments)
       }
       return GetCurrentWeather(params.Location, params.Unit), nil
    } else {
       return "", fmt.Errorf("got unavailable function name=%s arguments=%s", name, arguments)
    }
}

// GetCurrentWeather get the current weather in a given location.
// Example dummy function hard coded to return the same weather.
// In production, this could be your backend API or an external API
func GetCurrentWeather(location, unit string) string {
    if unit == "" {
       unit = "celsius"
    }
    switch strings.ToLower(location) {
    case "london":
       return `{"location": "London", "temperature": "10", "unit": unit}`
    case "London":
       return `{"location": "London", "temperature": "10", "unit": unit}`
    case "new york":
       return `{"location": "New York", "temperature": "23", "unit": unit}`
    case "New York":
       return `{"location": "New York", "temperature": "23", "unit": unit}`
    default:
       return fmt.Sprintf(`{"location": %s, "temperature": "unknown"}`, location)
    }
}
func MustMarshal(v interface{}) string {
    b, _ := json.Marshal(v)
    return string(b)
}
```



</Tab>
<Tab zoneid="RnlvWFEm1T" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import json
import time
from byteplussdkarkruntime import Ark

# Load API key from environment variable
api_key = os.getenv('ARK_API_KEY')

# Initialize Ark client
client = Ark(
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    api_key=api_key,
)

print("=" * 60)

# Initial conversation history with user query
messages = [
    {
        "role": "user",
        "content": "First query the weather in London. If it is sunny, send a message to Alan via WhatsApp, otherwise send it to Peter",
    },
]

# Tool definitions for function calling
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "Geographic location, for example, London City",
                    },
                    "unit": {"type": "string", "description": "Valid values [Celsius, Fahrenheit]"},
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "SendMessage",
            "description": "Send a message to the specified user via WhatsApp",
            "parameters": {
                "type": "object",
                "properties": {
                    "receiver": {
                        "type": "string",
                        "description": "Recipient username",
                    },
                    "content": {
                        "type": "string",
                        "description": "Message content",
                    },
                },
                "required": ["receiver", "content"],
            },
        },
    },
]

# Mock function to simulate weather API
def mock_get_current_weather(location, unit="Celsius"):
    if unit == "Fahrenheit":
        return f"{location} today is 68~75 degrees Fahrenheit, weather: showers"
    else:
        return f"{location} today is 20~24 degrees Celsius, weather: showers"

# Mock function to simulate message sending
def mock_send_message(receiver, content):
    return f"WhatsApp message successfully sent to {receiver}"

# Handle tool calls by dispatching to appropriate mock functions
def handle_tool_call(tool_call):
    function_name = tool_call.function.name
    function_args = json.loads(tool_call.function.arguments)

    if function_name == "get_current_weather":
        return mock_get_current_weather(**function_args)
    elif function_name == "SendMessage":
        return mock_send_message(**function_args)
    else:
        return f"Unknown function: {function_name}"

round_count = 0
max_rounds = 10
user_question_printed = False

while round_count < max_rounds:
    round_count += 1
    print(f"\n========== Round {round_count} ==========")

    if round_count == 1 and not user_question_printed:
        print(f"user: {messages[0]['content']}")
        user_question_printed = True

    start_time = time.time()

    # Call the model
    response = client.chat.completions.create(
        model="seed-2-0-lite-260228",
        messages=messages,
        tools=tools
    )
    elapsed_time = time.time() - start_time

    assistant_message = response.choices[0].message

    if assistant_message.tool_calls:
        for tool_call in assistant_message.tool_calls:
            print(f"assistant [FC Response]: {tool_call.function.name}, args={tool_call.function.arguments}")

            messages.append(assistant_message.model_dump())

            tool_result = handle_tool_call(tool_call)
            print(f"tool: {tool_result}")

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": tool_result,
                "name": tool_call.function.name,
            })
        print(f"Time elapsed: {elapsed_time:.2f} seconds")
    else:
        print(f"assistant [Final Answer]: {assistant_message.content}")
        print(f"Time elapsed: {elapsed_time:.2f} seconds")
        break

print("\n" + "=" * 60)
```



</Tab>
<Tab zoneid="g4WXDykxPm" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.byteplus.ark.runtime;

import com.byteplus.ark.runtime.model.completion.chat.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.*;
import java.util.concurrent.TimeUnit;

public class FunctionCallChatCompletionsExample {
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder().dispatcher(dispatcher).connectionPool(connectionPool).baseUrl("\\${BASE_URL}").apiKey(apiKey).build();

    public static void main(String[] args) {
        System.out.println("\n----- function call multiple rounds request -----");
        final List<ChatMessage> messages = new ArrayList<>();
        final ChatMessage userMessage = ChatMessage.builder().role(ChatMessageRole.USER).content("What's the weather like in London today?").build();
        messages.add(userMessage);

        final List<ChatTool> tools = Arrays.asList(
                new ChatTool(
                        "function",
                        new ChatFunction.Builder()
                                .name("get_current_weather")
                                .description("Get the weather for the specified location")
                                .parameters(new Weather(
                                        "object",
                                        new HashMap<String, Object>() {{
                                            put("location", new HashMap<String, String>() {{
                                                put("type", "string");
                                                put("description", "Location information of the place, for example, London");
                                            }});
                                            put("unit", new HashMap<String, Object>() {{
                                                put("type", "string");
                                                put("description", "Valid values include Celsius and Fahrenheit");
                                            }});
                                        }},
                                        Collections.singletonList("location")
                                ))
                                .build()
                )
        );

        ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
                .model("\\${YOUR_ENDPOINT_ID}")
                .messages(messages)
                .tools(tools)
                .build();

        ChatCompletionChoice choice = service.createChatCompletion(chatCompletionRequest).getChoices().get(0);
        messages.add(choice.getMessage());
        choice.getMessage().getToolCalls().forEach(
                toolCall -> {
                messages.add(ChatMessage.builder().role(ChatMessageRole.TOOL).toolCallId(toolCall.getId()).content("The weather in London is sunny, 24~30 degrees").name(toolCall.getFunction().getName()).build());
        });
        ChatCompletionRequest chatCompletionRequest2 = ChatCompletionRequest.builder()
                .model("\\${YOUR_ENDPOINT_ID}")
                .messages(messages)
                .build();

        service.createChatCompletion(chatCompletionRequest2).getChoices().forEach(System.out::println);

        // shutdown service
        service.shutdownExecutor();
    }

    public static class Weather {
        public String type;
        public Map<String, Object> properties;
        public List<String> required;

        public Weather(String type, Map<String, Object> properties, List<String> required) {
            this.type = type;
            this.properties = properties;
            this.required = required;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public Map<String, Object> getProperties() {
            return properties;
        }

        public void setProperties(Map<String, Object> properties) {
            this.properties = properties;
        }

        public List<String> getRequired() {
            return required;
        }

        public void setRequired(List<String> required) {
            this.required = required;
        }
    }

}
```



</Tab>
</Tabs>


<span id="5a7077bc"></span>
### Response example

```text
========== Round 1 ==========
user: First query the weather in London. If it is sunny, send a message to Alan via WhatsApp, otherwise send it to Peter...

assistant [FC Response]:
name=GetCurrentWeather, args={"location": "\u5317\u4eac"}
[elapsed=2.607 s]
========== Round 2 ==========
tool: Today's temperature in London is 20~24 degrees, weather: showers....

assistant [FC Response]:
name=SendMessage, args={"content": "\u4eca\u5929\u5317\u4eac\u7684\u5929\u6c14", "receiver": "Peter"}
[elapsed=3.492 s]
========== Round 3 ==========
tool: WhatsApp message successfully sent to Peter...

assistant [Final Answer]:
Okay, is there anything else I can help you with?
[elapsed=0.659 s]
```


<span id="bcd008f7"></span>
### Notes for multi\-turn output

<span id="7cb9315c"></span>
#### **Output order in each round**

When a function call is triggered, the system first outputs `content` to the user, then generates `tool_calls` and ends the current round; **the content of the current round cannot depend on tool results**, and subsequent instructions need to be executed after the tool returns the `message`.

<span id="8f94fad4"></span>
#### **Multi\-turn output response integrity**

Strictly follow the order of `assistant (including tool_calls) → tool (including message) → assistant`. It is forbidden to skip the `tool message` response and send a new `assistant` message directly. Each `tool_calls` must correspond to a `message` (including success/error results) of the `tool` role. If it is missing, repeated calls or process interruption may be triggered by the `prefill` mechanism.

<span id="661e27a2"></span>
## Result optimization

If the result of the function call does not meet your expectations, you can try to optimize it in the following ways:


* **Switch to the latest model**: It is recommended that you choose the latest model version, which usually delivers better function calling results.

* **Perform model fine\-tuning**: The model performance can be targeted improved through supervised fine\-tuning (SFT) or reinforcement learning.

* **Function selection accuracy**: Improve the model's ability to select the correct function at the right time.

* **Parameter extraction capability**: Optimize the model's ability to parse user intent and generate accurate function input parameters.

* **Result summary quality**: Improve the model's summary of tool execution results to make it more natural and accurate.


<span id="4af7d9f1"></span>
# FAQs

<span id="f4c7043a"></span>
## Q: How to determine whether the model needs to call a function?

A: The model will make an independent judgment based on the user's question and tool definitions. If the returned result contains the `tool_calls` parameter, it means a tool needs to be called; if the `content` parameter has a direct reply, no tool call is required.

<span id="f6dabc98"></span>
## Q: Is parallel calling of multiple functions supported?

A: Parallel function calling is supported. By setting the `parallel_tool_calls` parameter to `true`, the model can return multiple function call messages at the same time, improving processing efficiency.

<span id="98e81afc"></span>
## Q: Why do hallucinations exist in the tool parameters returned by the model?

A: This is a common problem with large models. You can optimize the model's parameter generation capability through fine\-tuning (SFT), or specify the format and scope of parameters in the system prompt to reduce hallucinations. Some models (especially DeepSeek R1) have some parameter hallucination problems. For example, if you expect to call get_location first to get the city information, and then call get_weather for query, the R1 model may directly return nested calls like get_weather:{city: **get_location()** }. Please intervene in the system prompt to solve this problem and complete the call step by step.

<span id="e58184c4"></span>
## Q: How to handle function call failures?

A: Feed the tool failure information back to the model as a `role=tool` message, and the model will generate a corresponding reply based on the error information, such as "Sorry, the function call failed, please try again later.". With the above optimizations, developers can use function calling more efficiently for deep integration between large models and external tools, and building intelligent applications quickly.

<span id="46345c43"></span>
# Appendix: Tool function parameter construction specification

To ensure that the model calls the tool function correctly, you need to construct the `tools` object according to the following specifications, complying with the JSON Schema standard. This section mainly explains how to construct function call tools. For the use of tool functions, see [Steps](https://docs.byteplus.com/en/docs/ModelArk/1262342#4ddc710a).

<span id="ee5fd027"></span>
## Overall structure

```JSON
{
  "type": "function",
  "function": {
    "name": "...",          // Function name (lowercase + underscore)
    "description": "...",   // Function description
    "parameters": { ... }   // Parameter definition (JSON Schema format)
  }
}
```



* `type`: The type of the tool, which is a fixed value `function` here, indicating that this is a function calling tool.

* `function`: Contains detailed configurations such as function name, description, and parameters.


<span id="122305b1"></span>
## Parameter explanation

<span id="a7a7baae"></span>
### `function` parameters


<span aceTableMode="list" aceTableWidth="1,1,1,3"></span>
|**Parameter** |**Type** |**Required** |**Description** |
|---|---|---|---|
|name |string |Yes |Function name, the unique identifier of a function. It is recommended to use lowercase and underscore. |
|description |string |Yes |Description of the function's purpose. |
|parameters |object |Yes |Definition of function parameters, which must comply with JSON Schema format. |


<span id="d0764612"></span>
### `parameters` parameter

`parameters` must be an object that conforms to the JSON Schema format:

```JSON
{
  "type": "object",
  "properties": {
    "parameter_name": {
      "type": "string | number | boolean | object | array",
        "description": "Parameter description"
    }
  },
  "required": ["required_parameter"]
}
```



* `type`: Must be `"object"`.

* `properties`: Lists all supported parameter names and their types.

   * The `parameter_name` must be a unique string.

   * The parameter `type` must follow the [JSON specification](https://json-schema.org/docs). Supported types include string, number, boolean, integer, object, array.

   * `required`: Specifies the required parameter names in the function.

   * Other parameters vary slightly depending on the `type`, see the table below for details.



<span aceTableMode="list" aceTableWidth="1,2"></span>
|**`Type`** |**Examples** |
|---|---|
|string, integer, number, and boolean |N/A |
|object<br><br><br>* description: Brief description<br><br>* properties: Describes all attributes of the object<br><br>* required: Describes required attributes |* Example 1: Query user profiles with specific characteristics (based on age, gender, marital status, etc.)<br><br><br>```Python```<br>```"person": {```<br>```    "type": "object",```<br>```    "description": "Personal characteristics",```<br>```    "properties": {```<br>```        "age": {"type": "integer", "description": "Age"},```<br>```        "gender": {"type": "string", "description": "Gender"},```<br>```        "married": {"type": "boolean", "description": "Marital status"}```<br>```    },```<br>```    "required": ["age"]```<br>```}```<br> |
|array<br><br><br>* description: Brief description<br><br>* Use `"items": {"type": ITEM_TYPE}` to specify the datatype of array elements |* Example 1: Text array \- multiple web page links<br><br><br>```Bash```<br>```"url": {```<br>```    "type": "array",```<br>```    "description": "Up to 3 web page links to be parsed",```<br>```    "items": {"type": "string"}```<br>```  }```<br><br><br><br>* Example 2: Two\-dimensional array<br><br><br>```Go```<br>```"matrix": {```<br>```    "type": "array",```<br>```    "description": "Two-dimensional matrix to be calculated",```<br>```    "items": {"type": "array", "items": {"type": "number"}},```<br>```}```<br><br><br><br>* Example 3: Implement multiple selection via array<br><br><br>```JSON```<br>```"grade": {```<br>```    "description": "Grade, supports multiple selection",```<br>```    "type": "array",```<br>```    "items": {```<br>```        "type": "string",```<br>```        "description": "Valid values: \"Grade 1\", \"Grade 2\", \"Grade 3\", \"Grade 4\", \"Grade 5\", \"Grade 6\"."```<br>```    }```<br>```}```<br> |


<span id="594becc7"></span>
## Complete example

```JSON
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get weather information for the specified location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "City and country, e.g. London, UK"
        }
      },
      "required": ["location"]
    }
  }
}
```


<span id="f74ec900"></span>
## Notes


* **Case\-sensitive**: All parameter names are strictly case\-sensitive (it is recommended to always use lowercase).

* **Non\-English text processing**: Parameter names must be in English, and descriptions in non\-English languages can be placed in `description` (for example, the description of `location` can be "Ville et pays").

* **Schema compliance**: `parameters` must be a valid JSON Schema object, which can be verified by JSON Schema validation tools.


<span id="43221a39"></span>
## Best practices


1. Core guidelines for tool description

   * Describe the tool function, applicable (and forbidden) use cases, parameter meaning and impact, and restrictions (such as input length limit) in detail. It is recommended to use 3\-4 sentences for a single tool description.

   * Prioritize improving basic descriptions such as functions and parameters. Examples are only for supplement (be careful when adding examples for inference models).

2. Key points for function design

   * **Naming and parameters**: The function name should be intuitive (e.g. `parse_product_info`). The parameter description includes the format (e.g. `city: string`) and business meaning (e.g. "full name of the target city"), and the output definition should be clear (e.g. "return weather data in JSON format").

   * **System prompt**: Specify the call conditions through the prompt (e.g. "Trigger `get_product_detail` when the user asks for product details").

   * **Engineering design**:

      * Use enumeration types (e.g. `StatusEnum`) to avoid invalid parameters, and ensure intuitive logic (principle of least astonishment).

      * Ensure that humans can call the function correctly only with the document description (supplement answers to potential questions).

   * **Calling optimization**:

      * Known parameters are implicitly passed through the code capability of ModelArk (e.g. `submit_order` does not need to declare `user_id` repeatedly).

      * Merge fixed process functions (e.g. `query_location` and `mark_location` are integrated into `query_and_mark_location`).

3. Stability of the order of parameters

   Although object keys are unordered in the standard JSON specification, it is recommended to keep the order of internal parameters in properties fixed and consistent when providing tools definitions to large models. The reason is that the underlying layer of large models treats the JSON structure as a linear sequence of text tokens. A change in the order of parameters will cause the system prompt received by the model to change, which may affect the attention mechanism of the model, and then lead to slight differences in the order of function call parameters generated by the model or the final result. When performing prompt testing or regression testing, please ensure that the order of parameter definitions remains unchanged.




