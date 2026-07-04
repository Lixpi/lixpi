To have the model output a standard format that can be processed by programs (primarily JSON) instead of natural language, you can turn on the structured output capability to support standardized processing or presentation.

By configuring the **text.format** object, you can specify the model's output in JSON format and also define the JSON structure to limit the output fields.

Compared to controlling the model's JSON output format via prompts, using the structured output capability offers the following advantages:


* Reliable output: The output structure matches the expected data type, including field hierarchy, names, types, and order, preventing missing required fields or hallucinated enumeration values.

* Simple to use: The output format is defined through API fields, making prompts simpler without repeatedly emphasizing or using strong constraint wording in the prompt.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This capability is still in the beta phase. Proceed with caution when using it in the production environment.</div>


<span id="0047487f"></span>
## Model List

LLMs released after 250615, unless otherwise specified, support the Responses API by default. For the list of supported models, please refer to: [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1330310#25b394c2).

> `seed-1-6-flash-250715` does not support structured output.


<span id="7503fb44"></span>
## API documentation

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<span id="607e37db"></span>
## json_object mode

This code demonstrates how to use the Responses API to achieve JSON Object structured output.


<Tabs>
<Tab zoneid="SUdQSVtOC5" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "thinking": { "type": "disabled" },
    "text": {
      "format": {
        "type": "json_object"
      }
    },
    "input": [
      {
        "role": "system",
        "content": "You are a professional math teaching assistant. When receiving a user math problem, you need to output in a structured JSON format. The returned JSON should include the explanation and answer fields."
      },
      {
        "role": "user",
        "content": "What is the approximate value of the square root of three"
      }
    ]
  }'
```



</Tab>
<Tab zoneid="dOhOdgkkOF" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

api_key = os.getenv('ARK_API_KEY')

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228", 
    input=[
        {"role": "system", "content": 
         "You are a professional math teaching assistant. When receiving a user math problem, you need to output in a structured JSON format. The returned JSON should include the explanation and answer fields."
        },
        {"role": "user", "content": "What is the approximate value of the square root of three"}
    ],
    text={"format":{"type": "json_object"}}
)

print(response)
```



</Tab>
<Tab zoneid="yzskNYZFf0" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role: responses.MessageRole_system,
                                    Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "You are a professional math teaching assistant. When receiving a user math problem, you need to output in a structured JSON format. The returned JSON should include the explanation and answer fields."}},
                            },
                        },
                    },
                    {
                        Union: &responses.InputItem_EasyMessage{
                            EasyMessage: &responses.ItemEasyMessage{
                                Role:    responses.MessageRole_user,
                                Content: &responses.MessageContent{Union: &responses.MessageContent_StringValue{StringValue: "What is the approximate value of the square root of three"}},
                            },
                        },
                    },
                }},
            },
        },
        Text: &responses.ResponsesText{Format: &responses.TextFormat{Type: responses.TextType_json_object}}, 
    })
    if err != nil {
        fmt.Printf("stream error: %v", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="VkkiUrdKbf" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;
import com.byteplus.ark.runtime.model.responses.common.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.common.ResponsesTextFormat;


public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder()
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_SYSTEM).content(
                                MessageContent.builder().stringValue("You are a professional math teaching assistant. When receiving a user math problem, you need to output in a structured JSON format. The returned JSON should include the explanation and answer fields.").build()
                        ).build())
                        .addListItem(ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder().stringValue("What is the approximate value of the square root of three").build()
                        ).build())
                        .build())
                .text(ResponsesText.builder().format(ResponsesTextFormat.builder().type(ResponsesConstants.TEXT_TYPE_JSON_OBJECT).build()).build())
                .build();
        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="k5scNAGtOP" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

response = client.responses.create(
    model="seed-2-0-lite-260228", 
    input=[
        {"role": "system", "content": 
        "You are a professional math teaching assistant. When receiving a user math problem, you need to output in a structured JSON format. The returned JSON should include the explanation and answer fields."
        },
        {"role": "user", "content": "What is the approximate value of the square root of three"}
    ],
    text={"format":{"type": "json_object"}}
)

print(response)
```



</Tab>
</Tabs>


Return preview

```JSON
{
    "explanation": "The square root of three (√3) is an irrational number, meaning it cannot be expressed as a simple fraction and its decimal expansion is non-repeating and non-terminating. To find its approximate value, we can use methods such as long division, a calculator, or reference known approximations. A commonly used approximate value is rounded to two decimal places, which is 1.73. For more precision, it can be approximated to three decimal places as 1.732, or further to 1.73205 for five decimal places.",
    "answer": "Approximately 1.73 (rounded to two decimal places) or 1.732 (rounded to three decimal places)"
}
```


<span id="f4619f55"></span>
## json_schema mode

This code demonstrates how to use the Responses API to achieve JSON structured output that follows schema field definitions.


<Tabs>
<Tab zoneid="jfRgdwwBdC" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seed-2-0-lite-260228",
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "return in json format how can I solve 8x + 7 = -23"
                }
            ]
        }
    ],
    "thinking": {
        "type": "disabled"
    },
    "stream": false,
    "text": {
        "format": {
            "type": "json_schema",
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
            }
        }
    }
  }'
```



</Tab>
<Tab zoneid="XvDwJOaCcD" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI
from pydantic import BaseModel
api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)
class Step(BaseModel):
    explanation: str  # Step details
    output: str       # Step computation results

class MathResponse(BaseModel):
    steps: list[Step]       # List of solution steps
    final_answer: str       # Final answer
response = client.responses.parse(
    model="seed-2-0-lite-260228", 
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "return in json format how can I solve 8x + 7 = -23"
                }
            ]
        }
    ],
    text_format=MathResponse
)

print(response.output_parsed)
```



</Tab>
</Tabs>


Return preview

```JSON
{
    "steps": [
        {
            "explanation": "Subtract 7 from both sides to isolate the term with x",
            "output": "8x = -23 - 7"
        },
        {
            "explanation": "Simplify the right side",
            "output": "8x = -30"
        },
        {
            "explanation": "Divide both sides by 8 to solve for x",
            "output": "x = -30/8"
        },
        {
            "explanation": "Simplify the fraction",
            "output": "x = -15/4"
        }
    ],
    "final_answer": "x = -15/4"
}
```


<span id="f5afc902"></span>
## Mode comparison: `json_object` and `json_schema`

`json_schema` is the updated version of `json_object`.

Both modes support JSON structured output, with the following similarities and differences.


|Structured output |`json_schema` |`json_object` |
|---|---|---|
|Generate JSON reply |Supported |Supported |
|JSON structure can be defined |Supported |Not supported<br><br>Only ensures the reply is a valid JSON |
|Recommended |Supported |Not supported |
|Supported models |See [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1330310#25b394c2) |See [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1330310#25b394c2) |
|Strict mode |Supported<br><br>Takes effect when **strict** is set to `true`. |Not supported |
|Syntax |```JSON```<br>```"text": {```<br>```    "format": {```<br>```        "type": "json_schema",```<br>```        "name": "my_schema",```<br>```        "strict": true,```<br>```        "schema": {```<br>```            ...```<br>```        }```<br>```    }```<br>```}```<br> |```JSON```<br>```"text": {```<br>```  "format": {```<br>```    "type": "json_object"```<br>```  }```<br>```}```<br> |


<span id="b9885e72"></span>
## Rate limits


* The Responses API QPS rate limits are as follows. If you need to increase the rate limit value, please submit [Ticket](https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514).



|API |Account\-level QPS rate limits |
|---|---|
|Create a model response |None |
|Query a model response |20 |
|List input items |20 |
|Delete a model response |20 |




