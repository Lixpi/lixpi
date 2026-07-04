
<span id="9be118a3"></span>
# Quick start

Complete your first API call: [Quick start](https://docs.byteplus.com/en/docs/ModelArk/1399008)


<Tabs>
<Tab zoneid="hdW1TcaRID" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="hello", # Replace with your prompt
    # thinking={"type": "disabled"}, #  Manually disable deep thinking
)
print(response)
```



</Tab>
<Tab zoneid="azdux2OPMi" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
      "model": "seed-2-0-lite-260228",
      "input": "hello"
  }'
```



</Tab>
<Tab zoneid="KHu8Bs7FLZ" title="Go">
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
        Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_StringValue{StringValue: "hello"}}, // Replace with your prompt
        // Thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()}, // Manually disable deep thinking
    })
    if err != nil {
        fmt.Printf("response error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="Rc8yZaASmb" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        // The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();


        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().stringValue("hello").build()) // Replace with your prompt
                // .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build()) //  Manually disable deep thinking
                .build();


        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);


        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="GAU5ujLVTA" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="seed-2-0-lite-260228",
    input="hello", # Replace with your prompt
    extra_body={
        # "thinking": {"type": "disabled"}, #  Manually disable deep thinking
    },
)

print(response)
```



</Tab>
</Tabs>


<span id="fc299dc6"></span>
# Models

All models can be found at: [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310)

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>Region availability</strong>:</div>


   * <div data-tips="true" data-tips-type="tip">Currently, all the models listed in <a href="https://docs.byteplus.com/en/docs/ModelArk/1330310">Model list</a> are supported in the <code>ap-southeast-1</code> region.</div>


   * <div data-tips="true" data-tips-type="tip">The seed\-2\-0 and seedream\-5\-0\-lite models are also supported in the <code>eu-west-1</code> region.</div>


* <div data-tips="true" data-tips-type="tip">Base URL by region:</div>


   * <div data-tips="true" data-tips-type="tip"><code>ap-southeast-1</code>: <code>https://ark.ap-southeast.bytepluses.com/api/v3</code></div>


   * <div data-tips="true" data-tips-type="tip"><code>eu-west-1</code>: <code>https://ark.eu-west.bytepluses.com/api/v3</code></div>



<div data-tips="true" data-tips-type="tip">For more information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191806">Region availability</a>.</div>



<columns>
<columnsItem zoneid="iz2XlEUxMK">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_thinking.png" >

**Dola Seed 2.0**

**Flagship general\\-purpose agentic model**

Built for complex reasoning and long\\-chain, multi\\-step task execution in the Agent era

</card>



</columnsItem>
<columnsItem zoneid="Kaadz7U1MF">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_video_generation.png" >

**Dreamina Seedance 2.0**

**Mainline video generation model**

High\\-fidelity audio–visual synchronization, high motion quality and emotional expression

</card>



</columnsItem>
<columnsItem zoneid="PI8rXjuDtn">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_image_generation.png" >

**Dola Seedream 5.0**

**Leading image generation model**

Enhanced reference consistency and improved generation quality for professional scenarios

</card>



</columnsItem>
</columns>


<span id="a87182d8"></span>
# Basic usage

Learn about model usage, rate limits, and code samples for common use cases.


<columns>
<columnsItem zoneid="u0Jg1tuBi2">


<card mode="section" href="/en/docs/ModelArk/1449737" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/deep-thinking.svg" iconsize="m" horizontal="true" >

Deep reasoning

Think before answering for significantly improved response quality

</card>




<card mode="section" href="/en/docs/ModelArk/1362931" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/image-understanding.svg" iconsize="m" horizontal="true" >

Image understanding

Accepts images and replies based on image information

</card>




<card mode="section" href="/en/docs/ModelArk/1895586" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/video-understanding.svg" iconsize="m" horizontal="true" >

Video understanding

Accepts videos and replies based on video information

</card>




<card mode="section" href="/en/docs/ModelArk/1902647" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/document-understanding.svg" iconsize="m" horizontal="true" >

Document understanding

Accepts PDFs and replies based on document information

</card>



</columnsItem>
<columnsItem zoneid="MuZiAFEcM2">


<card mode="section" href="/en/docs/ModelArk/2298881" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/video-generation.svg" iconsize="m" horizontal="true" >

Video generation

Generates high\\-definition professional videos

</card>




<card mode="section" href="/en/docs/ModelArk/1824121" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/image-generation.svg" iconsize="m" horizontal="true" >

Image generation

Generates high\\-quality images based on text and images

</card>




<card mode="section" href="/en/docs/ModelArk/InfoQuest" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/web-search.svg" iconsize="m" horizontal="true" >

Web search

Obtains real\\-time knowledge via internet

</card>




<card mode="section" href="/en/docs/ModelArk/1262342" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/function-calling.svg" iconsize="m" horizontal="true" >

Function calling

Calls custom tools to enhance model capabilities

</card>



</columnsItem>
</columns>


<span id="bfd5f286"></span>
# Advanced usage

Learn how to expand model capabilities, improve performance, and reduce costs.


<columns>
<columnsItem zoneid="X35VEmW5tW">


<card mode="section" href="/en/docs/ModelArk/1359497" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/prefill.svg" iconsize="m" horizontal="true" >

Prefill\\-based response

Prefill part of the \`assistant\` message content to guide and control the model output

</card>




<card mode="section" href="/en/docs/ModelArk/1616136" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/grounding.svg" iconsize="m" horizontal="true" >

Visual grounding

Find targets in the image and return the coordinates

</card>




<card mode="section" href="/en/docs/ModelArk/1885708" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/file-api.svg" iconsize="m" horizontal="true" >

File input

Use File API to upload and preprocess videos, images, and PDFs

</card>



</columnsItem>
<columnsItem zoneid="XPWcTQAcOj">


<card mode="section" href="/en/docs/ModelArk/1399517" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/batch.svg" iconsize="m" horizontal="true" >

Batch inference

Significantly improves throughput, reduces costs, and is suitable for tasks that do not require an immediate response

</card>




<card mode="section" href="/en/docs/ModelArk/1602228" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/context-caching.svg" iconsize="m" horizontal="true" >

Context caching

Cache fixed context to reduce repeated computing costs

</card>




<card mode="section" href="/en/docs/ModelArk/1827534" icon="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/svg/MCP.svg" iconsize="m" horizontal="true" >

Cloud\\-deployed MCP

Call various MCP tools in vertical domains to enhance model capabilities

</card>



</columnsItem>
</columns>


