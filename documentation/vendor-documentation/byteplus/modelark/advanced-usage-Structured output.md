When you need the model to output in standard formats (mainly JSON format) like a program instead of natural language, you can enable structured output to support standardized processing or display. By configuring the **response_format** object, you can demand the model to output in JSON format, and you can also define the JSON structure to limit the model's output parameters. Compared with controlling the model to output in JSON format through prompts, using the structured output capability has the following advantages:


* Reliable output: The output structure always conforms to the expected data type, including parameter hierarchy, name, type, order, etc., avoiding missing necessary parameters or generating hallucinated valid values.

* Easy to use: You can define the output format via API parameters, so you can use simpler prompts and you don't have to repeatedly emphasize or use strong wording in prompts.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This capability is still in the beta phase. Proceed with caution when using it in the production environment.</div>


<span id="3aae5325"></span>
# Supported models

See [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1330310#25b394c2).

<span id="bbefb0e1"></span>
# API documentation


* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): Parameter explanation for structured output API. The examples in this document are Chat API examples.

* [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request): New API for calling models. See [Structured output (Responses API)](https://docs.byteplus.com/en/docs/ModelArk/1958523)for usage examples.


<span id="87d19412"></span>
# Quick start

<span id="7b9d4fd7"></span>
## json_schema mode

This code sample shows how to use the Chat API to implement JSON structured output that conforms to the schema parameter definition.

> For examples of implementing JSON structured output that conforms to the schema parameter definition using the Responses API, see [json_schema mode](https://docs.byteplus.com/en/docs/ModelArk/1958523#f4619f55).



<Tabs>
<Tab zoneid="G83GyyaK8P" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "model": "seed-1-6-250915",
  "messages": [
    {
      "role": "system",
      "content": "You are a math tutor."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Solve the problem: 8x + 9 = 32 and x + y = 1"
        }
      ]
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "math_reasoning",
      "schema": {
        "type": "object",
        "properties": {
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "explanation": {
                  "type": "string"
                },
                "output": {
                  "type": "string"
                }
              },
              "required": [
                "explanation",
                "output"
              ],
              "additionalProperties": false
            }
          },
          "final_answer": {
            "type": "string"
          }
        },
        "required": [
          "steps",
          "final_answer"
        ],
        "additionalProperties": false
      },
      "strict": true
    }
  },
  "thinking": {
    "type": "disabled"
  }
}'
```


You can control whether the model enables deep reasoning through the **thinking** parameter.


* `"disabled"`: Do not use deep reasoning.

* `"enabled"`: Force the use of deep reasoning.


</Tab>
<Tab zoneid="KwFxoFJZH3" title="Python">
<TabTitle>Python</TabTitle>

```Python
from byteplussdkarkruntime import Ark
import os
from pydantic import BaseModel  # Used to define the response parsing model

# Initialize ModelArk SDK client
client = Ark(
    # Obtain ModelArk API Key from environment variables (environment variables must be set in advance)
    api_key=os.environ.get("ARK_API_KEY"),
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3"
)

# Define stepwise parsing model (structured response for the business scenario)
class Step(BaseModel):
    explanation: str  # Step description
    output: str       # Step calculation result

# Define the final response model (includes stepwise process and final answer)
class MathResponse(BaseModel):
    steps: list[Step]       # List of solution steps
    final_answer: str       # Final answer

# Call ModelArk model to generate response (automatically parsed into the specified model)
completion = client.beta.chat.completions.parse(
    model="seed-1-6-250915",  # The specific model needs to be replaced with an actually available model
    messages=[
        {"role": "system", "content": "You are a math tutor, you need to show the problem-solving steps in detail"},
        {"role": "user", "content": "Solve the system of equations in Chinese: 8x + 9 = 32 and x + y = 1"}
    ],
    response_format=MathResponse,  # Specify response parsing model
    extra_body={
         "thinking": {
             "type": "disabled" # Do not use deep reasoning capability
             # "type": "enabled" # Use deep reasoning capability
         }
     }
)

# Extract the parsed structured response
resp = completion.choices[0].message.parsed

# Print formatted JSON result
print(resp.model_dump_json(indent=2))
```



</Tab>
<Tab zoneid="QDtYVY5SYc" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "github.com/invopop/jsonschema" // required go1.18+
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

// Define stepwise parsing model (structured response for the business scenario)
type Step struct {
    Explanation string `json:"explanation" jsonschema_description:"Step description"`
    Output      string `json:"output" jsonschema_description:"Step calculation result"`
}

// Define the final response model (includes stepwise process and final answer)
type MathResponse struct {
    Steps       []Step `json:"steps" jsonschema_description:"List of problem-solving steps"`
    FinalAnswer string `json:"final_answer" jsonschema_description:"Final answer"`
}

// Reuse the original Schema generation function (optimized return type)
func GenerateSchema[T any]() *jsonschema.Schema { // <-- Optimize return type to specific Schema type
    reflector := jsonschema.Reflector{
        AllowAdditionalProperties: false,
        DoNotReference:            true,
    }
    return reflector.Reflect(new(T)) // Use new(T) to avoid null value issues
}

// Generate JSON Schema for mathematical response
var MathResponseSchema = GenerateSchema[MathResponse]()

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        )
    ctx := context.Background()

    // Construct request message (includes system and user roles)
    messages := []*model.ChatCompletionMessage{
        {
            Role: model.ChatMessageRoleSystem,
            Content: &model.ChatCompletionMessageContent{
                StringValue: volcengine.String("You are a math tutor, you need to show the problem-solving steps in detail"),
            },
        },
        {
            Role: model.ChatMessageRoleUser,
            Content: &model.ChatCompletionMessageContent{
                StringValue: volcengine.String("Solve the system of equations in Chinese: 8x + 9 = 32 and x + y = 1"),
            },
        },
    }

    // Configure response format (using MathResponse's Schema)
    schemaParam := model.ResponseFormatJSONSchemaJSONSchemaParam{
        Name:        "math_response", // Corresponds to response name in Python
        Description: "Structured response for math problem solutions",
        Schema:      MathResponseSchema,
        Strict:      true,
    }

    // Construct request (includes thinking configuration)
    req := model.CreateChatCompletionRequest{
        Model:    "seed-1-6-250915", // Needs to be replaced with an actually available model
        Messages: messages,
        ResponseFormat: &model.ResponseFormat{
            Type:       model.ResponseFormatJSONSchema,
            JSONSchema: &schemaParam,
        },
        Thinking: &model.Thinking{
            // Type: model.ThinkingTypeDisabled, // turn off deep reasoning capability
            Type: model.ThinkingTypeEnabled, // turn on deep reasoning capability
        },
    }


    // Call API
    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
        fmt.Printf("structured output chat error: %v\\n", err)
        return
    }


    // Parse structured response (key difference: Go requires manual deserialization)
    var mathResp MathResponse
    err = json.Unmarshal([]byte(*resp.Choices[0].Message.Content.StringValue), &mathResp)
    if err != nil {
        panic(err.Error())
    }


    // Print formatted result (use json.MarshalIndent for indentation)
    prettyJSON, _ := json.MarshalIndent(mathResp, "", "  ")
    fmt.Println(string(prettyJSON))
}
```



</Tab>
<Tab zoneid="LxX2VivtuC" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.example;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest.ChatCompletionRequestResponseFormat;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.model.completion.chat.ResponseFormatJSONSchemaJSONSchemaParam;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ChatCompletionsStructuredOutputsExamplev4 {
    static String apiKey = System.getenv("ARK_API_KEY");
    static ArkService service = ArkService.builder()
            .connectionPool(new ConnectionPool(5, 1, TimeUnit.SECONDS))
            .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
            .dispatcher(new Dispatcher())
            .apiKey(apiKey)
            .build();

    public static void main(String[] args) throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();

        // Construct message list (includes system and user roles)
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.builder()
                .role(ChatMessageRole.SYSTEM)
                .content("You are a math tutor, you need to show the problem-solving steps in detail")
                .build());
        messages.add(ChatMessage.builder()
                .role(ChatMessageRole.USER)
                .content("Solve the system of equations in Chinese: 8x + 9 = 32 and x + y = 1")
                .build());

        // Generate JSON Schema
        JsonNode schemaNode = mapper.readTree(schemaJson);

        // Configure response format
        ChatCompletionRequestResponseFormat responseFormat = new ChatCompletionRequestResponseFormat(
                "json_schema",
                new ResponseFormatJSONSchemaJSONSchemaParam(
                        "math_response",
                        "Structured response for math problem solutions",
                        schemaNode,
                        true
                )
        );

        // Construct request (includes thinking configuration)
        ChatCompletionRequest request = ChatCompletionRequest.builder()
                .model("seed-1-6-250915") // Replace with the model actually used
                .messages(messages)
                .responseFormat(responseFormat)
                .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("disabled")) // turn off model deep reasoning capability
                .build();

        // Call the API and parse the response
        var response = service.createChatCompletion(request);
        if (!response.getChoices().isEmpty()) {
            String content = String.valueOf(response.getChoices().get(0).getMessage().getContent());
            JsonNode jsonNode = mapper.readTree(content);
            // Print the formatted result
            System.out.println(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(jsonNode));
        }

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="PR3ZWv7B7r" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
from openai import OpenAI
import os
from pydantic import BaseModel

client = OpenAI(
    # Obtain the ModelArk API Key from environment variables
    api_key=os.environ.get("ARK_API_KEY"),
    base_url = "https://ark.ap-southeast.bytepluses.com/api/v3"
)

class Step(BaseModel):
    explanation: str
    output: str
class MathResponse(BaseModel):
    steps: list[Step]
    final_answer: str
    
completion = client.beta.chat.completions.parse(
    model = "seed-1-6-250915",  # Replace with the model you need to use
    messages = [
        {"role": "system", "content": "You are a math tutor."},
        {"role": "user", "content": "Solve the system of equations in Chinese: 8x + 9 = 32 and x + y = 1"},
    ],
    response_format=MathResponse,
    extra_body={
         "thinking": {
             "type": "disabled" # Do not use deep reasoning ability
             # "type": "enabled" # Use deep reasoning ability
         }
     }
)
resp = completion.choices[0].message.parsed
# Print results in JSON format
print(resp.model_dump_json(indent=2))
```



</Tab>
</Tabs>


Response preview

```JSON
{
  "steps": [
    {
      "explanation": "To solve the first equation 8x + 9 = 32, first subtract 9 from both sides of the equation to get 8x = 32 - 9",
      "output": "8x = 23"
    },
    {
      "explanation": "Then divide both sides of the equation by 8 to find the value of x",
      "output": "x = 23/8"
    },
    {
      "explanation": "Substitute x = 23/8 into the second equation x + y = 1 to solve for y, that is y = 1 - x",
      "output": "y = 1 - 23/8"
    },
    {
      "explanation": "Calculate 1 - 23/8, and get (8 - 23)/8 after finding a common denominator",
      "output": "y = -15/8"
    }
  ],
  "final_answer": "x = 23/8, y = -15/8"
}
```


<span id="47db26a6"></span>
## json_object mode

You need to include the string json in the input information, and configure `"response_format":{"type": "json_object"}`.

> For an example of implementing JSON Object structured output using the Responses API, see [json_object mode](https://docs.byteplus.com/en/docs/ModelArk/1958523#607e37db).



<Tabs>
<Tab zoneid="fkcXcatKca" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "model": "seed-1-6-250915",
  "messages": [
    {"role": "user", "content": "What are common cruciferous plants? Output in json"}
  ],
  "thinking": {
    "type": "disabled"
  },
  "response_format":{
    "type": "json_object"
  }
}'
```


You can control whether the model enables deep reasoning through the **thinking** parameter.

```Plain Text
* `"disabled"`: Do not use deep reasoning.

* `"enabled"`: Force the use of deep reasoning.
```



</Tab>
<Tab zoneid="X53kM9A5dK" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)

completion = client.chat.completions.create(
    #Replace with Model ID
    model = "seed-1-6-250915",
    messages=[
        {"role": "user", "content": "What are common cruciferous plants? Output in json"}
    ],
    response_format={"type":"json_object"},
    thinking={"type": "disabled"},# Do not use deep reasoning abilities
)

# Print original response content
print(completion.choices[0].message.content)
```



</Tab>
<Tab zoneid="thR2HIwjG0" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
        )
    ctx := context.Background()

    // Construct the request message
    messages := []*model.ChatCompletionMessage{
        {
            Role: model.ChatMessageRoleUser,
            Content: &model.ChatCompletionMessageContent{
                StringValue: volcengine.String("What are common cruciferous plants? Output in json"),
            },
        },
    }

    // Construct the request (including Thinking configuration)
    req := model.CreateChatCompletionRequest{
        Model:    "seed-1-6-250915", //Replace with Model ID
        Messages: messages,
        ResponseFormat: &model.ResponseFormat{
            Type:       model.ResponseFormatJsonObject,
        },
        Thinking: &model.Thinking{
            Type: model.ThinkingTypeDisabled, // Turn off deep reasoning capability
            // Type: model.ThinkingTypeEnabled, // turn on deep reasoning capability
        },
    }

    // Call the API
    resp, err := client.CreateChatCompletion(ctx, req)
    if err != nil {
        fmt.Printf("chat error: %v\n", err)
        return
    }
    
    fmt.Println(*resp.Choices[0].Message.Content.StringValue)
}
```



</Tab>
<Tab zoneid="o0iIDwjHJa" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.example;

import com.byteplus.ark.runtime.model.completion.chat.ChatCompletionRequest;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessage;
import com.byteplus.ark.runtime.model.completion.chat.ChatMessageRole;
import com.byteplus.ark.runtime.service.ArkService;

import java.util.ArrayList;
import java.util.List;

/**
 * This is a sample class that demonstrates how to use ArkService to implement chat functionality.
*/
public class ChatCompletionsExample {
  public static void main(String[] args) {
    // Get the API key from environment variables
    String apiKey = System.getenv("ARK_API_KEY");

    // Create an ArkService instance
    ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

    // Initialize the message list.
    List<ChatMessage> chatMessages = new ArrayList<>();

    // Create user message
    ChatMessage userMessage = ChatMessage.builder()
        .role(ChatMessageRole.USER) // Set the message role to user
        .content("What are common cruciferous plants? Output in json") // set message content
        .build();

    // Add user message to the message list
    chatMessages.add(userMessage);
    
    // Create chat completion request
    ChatCompletionRequest chatCompletionRequest = ChatCompletionRequest.builder()
        .model("seed-1-6-250915")//Replace with Model ID
        .messages(chatMessages) // Set message list
        .responseFormat(new ChatCompletionRequest.ChatCompletionRequestResponseFormat("json_object"))
        .thinking(new ChatCompletionRequest.ChatCompletionRequestThinking("disabled"))
        .build();

    // Send chat completion request and print response
    try {
      // Get response and print the message content of each choice
      arkService.createChatCompletion(chatCompletionRequest)
          .getChoices()
          .forEach(choice -> System.out.println(choice.getMessage().getContent()));
    } catch (Exception e) {
      System.out.println("Request failed: " + e.getMessage());
    } finally {
      // Shut down service executor
      arkService.shutdownExecutor();
    }
  }
}
```



</Tab>
<Tab zoneid="qsS99FMf5J" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
from openai import OpenAI
import os

# Initialize the client.
client = OpenAI(
    # Get ModelArk API Key from environment variables (environment variables must be set in advance)
    api_key=os.environ.get("ARK_API_KEY"),
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3"
)

# Call ModelArk model to generate a response
completion = client.chat.completions.create(
    model="seed-1-6-250915",  #Replace with Model ID
    messages=[
        {"role": "user", "content": "What are common cruciferous plants? Output in json"}
    ],
    response_format={"type":"json_object"},
    extra_body={
         "thinking": {
             "type": "disabled" # Do not use deep reasoning capabilities
             # "type": "enabled" # Use deep reasoning skills
         }
     },
)

# Print original response content
print(completion.choices[0].message.content)
```



</Tab>
</Tabs>


Response preview

```JSON
{
  "common_cruciferous_plants": [
    "Bokchoy",
    "Radish",
    "Rapeseed greens",
    "Cabbage",
    "Cauliflower",
    "Broccoli",
    "Mustard greens",
    "Pickled mustard tuber",
    "Potherb mustard",
    "Turnip",
    "Kale",
    "Shepherd's purse",
    "Orychophragmus violaceus (February orchid)",
    "Peppergrass",
    "Violet"
  ]
}
```


<span id="3e3c187a"></span>
# Mode comparison: **`json_schema`** vs. `json_object`

`json_schema` is the evolved version of `json_object`, both modes support JSON structured output, the specific similarities and differences are as follows.

> The `json_schema` function is currently in beta testing, please evaluate carefully before using it in production environments.



|Structured output |`json_schema` |`json_object` |
|---|---|---|
|Generate JSON response |Supported |Supported |
|JSON structure can be defined |Supported |Not supported<br><br>Only ensures the response is valid JSON |
|Recommended |Supported |Not supported |
|Supported models |See [Supported models](https://docs.byteplus.com/en/docs/ModelArk/1568221#3aae5325) |See [Supported models](https://docs.byteplus.com/en/docs/ModelArk/1568221#3aae5325) |
|Strict mode<br><br>> Generate responses strictly in accordance with the defined structure. |Supported<br><br>Takes effect by setting **strict** to `true`.<br><br><br>* See [Appendix 1. JSON Schema syntax support](https://docs.byteplus.com/en/docs/ModelArk/1568221#07ec5656) for syntax explanation. An error will be displayed if there is an unsupported structure. |Not applicable |
|Configuration |...,<br><br>"response_format": {<br><br>"type": "json_schema",<br><br>"json_schema":{<br><br>"name":"my_schema",<br><br>"strict": true,<br><br>"schema": {...}<br><br>}<br><br>},<br><br>... |...,<br><br>"response_format": {<br><br>"type": "json_object"<br><br>},<br><br>... |


<span id="7683a597"></span>
# Recommended usage steps

<span id="8d92bc51"></span>
## 1. Define the structure

Define the JSON structure of the model response in the **schema** parameter. You can refer to the example in [Quick start](https://docs.byteplus.com/en/docs/ModelArk/1568221#87d19412).


* The strict mode:

   * Strict mode enabled (`strict: true`): The model outputs content strictly in accordance with the structure defined in **schema**. Keywords supported by ModelArk can be found in [Appendix 1. JSON Schema syntax support](https://docs.byteplus.com/en/docs/ModelArk/1568221#07ec5656). ModelArk will display an explicit error if there is an obviously unsupported definition.

   * Strict mode disabled (`strict: false` or the **strict** parameter is not configured): The model outputs content with a valid JSON structure, prioritizes referencing the structure defined in **schema**, and will not validate syntax or throw errors.

* Parameter order: The model will output data according to the parameter order defined in **schema**. Please pay attention to the order of parameters at the same level.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Better generation quality can be achieved by designing JSON Schema and prompts. We strongly recommend that you read <a href="https://docs.byteplus.com/en/docs/ModelArk/1568221#3267c790">Appendix 2. JSON Schema definition suggestions</a> and <a href="https://docs.byteplus.com/en/docs/ModelArk/1568221#05849c36">Appendix 3: Prompt suggestions</a>.</div>


<span id="9915283f"></span>
## 2. Configure JSON Schema in the API

Specify the structured output mode in the API

```JSON
...,
"response_format": { 
  "type": "json_schema", 
  "json_schema": {
    "name":"my_schema",
    "strict": true, 
    "schema": {...}
  }
},
...
```


For complete code samples, see [Quick start](https://docs.byteplus.com/en/docs/ModelArk/1568221#87d19412).

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Do not use it together with sampling parameters such as <strong>frequency_penalty</strong> and <strong>presence_penalty</strong>, as this may cause abnormal model output.</div>


<span id="adf6252e"></span>
## 3. Handling error cases

The model output structure may still contain errors due to output length limits, task complexity, unclear format, etc.


* You can try to adjust the instructions, or split the task into simpler subtasks.

* You can use ModelArk's prompt optimization tool to optimize model prompts, see [PromptPilot Overview](https://docs.byteplus.com/en/docs/ModelArk/1399496) for details.


<span id="07ec5656"></span>
# Appendix 1. JSON Schema syntax support

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">The keywords are classified by the scope. See the full set of valid JSON Schema keywords at: https://json\-schema.org/understanding\-json\-schema/keywords</div>


* <div data-tips="true" data-tips-type="tip">ModelArk supports the output format constraint semantics for the keywords listed below.</div>


* <div data-tips="true" data-tips-type="tip">ModelArk will ignore keywords in the JSON Schema specification that have no format constraint semantics.</div>


* <div data-tips="true" data-tips-type="tip">If you use explicitly unsupported keywords, ModelArk will throw an explicit error.</div>


* <div data-tips="true" data-tips-type="tip">Do not use it together with sampling parameters such as <strong>frequency_penalty</strong> and <strong>presence_penalty</strong>, as this may cause abnormal model output.</div>



<span id="cdc803ee"></span>
## Public keywords at the Schema level


* [type](https://www.learnjsonschema.com/2020-12/validation/type/)

   * integer

   * number

   * string

   * boolean

   * null

   * array

   * object

* [$ref](https://www.learnjsonschema.com/2020-12/core/ref/)

   * Only supports local relative references prefixed with `#`

* [$defs](https://www.learnjsonschema.com/2020-12/core/defs/)

* [const](https://www.learnjsonschema.com/2020-12/validation/const/)

* [enum](https://www.learnjsonschema.com/2020-12/validation/enum/)

* [anyOf](https://www.learnjsonschema.com/2020-12/applicator/anyof/)

* [oneOf](https://www.learnjsonschema.com/2020-12/applicator/oneof/)

   * Does not strictly guarantee the 'exactly one' semantics

* [allOf](https://www.learnjsonschema.com/2020-12/applicator/allof/)

   * Does not strictly guarantee the 'all' semantics


<span id="d2f98d7f"></span>
## Keywords related to type


* "type": "array"

   * [prefixItems](https://www.learnjsonschema.com/2020-12/applicator/prefixitems/)

   * [items](https://www.learnjsonschema.com/2020-12/applicator/items/)

   * [unevaluatedItems](https://www.learnjsonschema.com/2020-12/unevaluated/unevaluateditems/)

* "type": "object"

   * [properties](https://www.learnjsonschema.com/2020-12/applicator/properties/)

   * [required](https://www.learnjsonschema.com/2020-12/validation/required/)

   * [additionalProperties](https://www.learnjsonschema.com/2020-12/applicator/additionalproperties/)

   * [unevaluatedProperties](https://www.learnjsonschema.com/2020-12/unevaluated/unevaluatedproperties/)


<span id="3267c790"></span>
# Appendix 2. JSON Schema definition suggestions

<span id="4eb8bb6c"></span>
### Parameter naming and description

Parameters with vague names or without description make it difficult for the model to tell the meaning. Use clear and meaningful English names (such as user_name) together with `description` to explain the purpose of the parameter in detail.


<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "v1": {```<br>```      "type": "string"```<br>```    }```<br>```  }```<br>```}```<br> |```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "user_name": {```<br>```      "type": "string",```<br>```      "description": "User name"```<br>```    }```<br>```  }```<br>```}```<br> |


<span id="b5dffb5a"></span>
### Parameter type and structure design

<span id="20cd2304"></span>
#### Avoid redundant nesting and unnecessary complexity

Do not overuse $ref, expand the structure as much as possible at one time. Meaningless nesting will increase the difficulty of model generation and the probability of errors.


<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "date": {```<br>```      "type": "object",```<br>```      "properties": {```<br>```        "value": {```<br>```          "type": "string",```<br>```          "description": "Date"```<br>```        }```<br>```      }```<br>```    }```<br>```  }```<br>```}```<br> |```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "date": {```<br>```      "type": "string",```<br>```      "description": "Date, in the format YYYY-MM-DD"```<br>```    }```<br>```  }```<br>```}```<br> |


<span id="28d8a165"></span>
#### Define suitable parameter types and provide examples

> Note: The type should match the actual business scenario as closely as possible. Do not use string for numbers and booleans.



<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "score": {```<br>```    "type": "string"```<br>```  }```<br>```}```<br> |```JSON```<br>```{```<br>```  "score": {```<br>```    "type": "integer",```<br>```    "description": "Score, an integer between 0 and 100"```<br>```  }```<br>```}```<br> |


<span id="7da8f5ac"></span>
### Parameter value and constraint design

Clarify valid values and formats


<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "status": {```<br>```    "type": "string"```<br>```  }```<br>```}```<br> |```JSON```<br>```{```<br>```  "status": {```<br>```    "type": "string",```<br>```    "description": "Processing status, valid values: pending, success or failed",```<br>```    "enum": ["pending", "success", "failed"]```<br>```  }```<br>```}```<br> |


<span id="064bc324"></span>
### Structure hierarchy and required parameters

Explicitly mark required parameters in all required structures, so that the model will always output all required parameters in a more standardized format.

When using required, it is recommended to always add `"additionalProperties": false`.


<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "steps": { "type": "array", "items": { "type": "string" } },```<br>```    "final_answer": { "type": "string" }```<br>```  }```<br>```  // Not required```<br>```}```<br> |```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "steps": { "type": "array", "items": { "type": "string" } },```<br>```    "final_answer": { "type": "string" }```<br>```  },```<br>```  "required": ["steps", "final_answer"],```<br>```  "additionalProperties": false```<br>```}```<br> |


<span id="04cb2281"></span>
### Business semantics should be concise and clear to avoid ambiguity


<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "id": { "type": "string", "description": "User or order ID" }```<br>```  }```<br>```}```<br> |```JSON```<br>```{```<br>```  "type": "object",```<br>```  "properties": {```<br>```    "user_id": { "type": "string", "description": "User ID" },```<br>```    "order_id": { "type": "string", "description": "Order ID" }```<br>```  }```<br>```}```<br> |


<span id="7d13f9fd"></span>
## Use tools for evaluation and optimization


* To avoid inconsistencies between JSON schema and programming language type definitions, it is recommended to use native language tools, for example, [Pydantic](https://docs.pydantic.dev/latest/), for Python, and [Zod](https://zod.dev/) for TypeScript.

* You can use ModelArk tools to optimize/evaluate model prompts. See [PromptPilot Overview](https://docs.byteplus.com/en/docs/ModelArk/1399496) for details.


<span id="05849c36"></span>
# Appendix 3: Prompt suggestions

<span id="0ca58701"></span>
### Specify task objectives and express intent concisely


* Just directly describe the task you actually want the model to complete, no need to repeatedly emphasize instructions such as "Please output in JSON format" or "Please output in the following format".

* Do not repeat schema structure information in the prompt to avoid contradiction or redundancy.



<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```Plain```<br>```Please output in the following JSON format, and include the parameters steps and final_answer: 8x + 9 = 32, x+y=1.```<br> |```Plain```<br>```Please solve: 8x + 9 = 32, x + y = 1.```<br> |


<span id="92eb1341"></span>
### Write business content combined with structured information instead of format guidance


* Focus on the "content", not the "output format".

* The more specific the business description is, the easier it is for LLM to generate content that conforms to the schema.



<span aceTableMode="list" aceTableWidth="1,1"></span>
|**Before** |**After** |
|---|---|
|```Plain```<br>```Please output a JSON that includes the parameters steps and final_answer.```<br> |```Plain```<br>```Please solve step by step: 8x + 9 = 32, x+y=1, and write the final answer.```<br> |




