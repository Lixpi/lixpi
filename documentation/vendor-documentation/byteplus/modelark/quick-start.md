Complete your first ModelArk API call within minutes.


<columns>
<columnsItem zoneid="PQHxcCHeVT">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/experience" >

**Model Playground**

Explore models interactively, no code required

</card>



</columnsItem>
<columnsItem zoneid="NK5gNg0bcV">


<card mode="container" href="/en/docs/ModelArk/1928261" >

**Coding Plan**

Boost your coding efficiency in major AI tools

</card>



</columnsItem>
</columns>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>Region availability</strong>:</div>


   * <div data-tips="true" data-tips-type="tip">Currently, all the models listed in <a href="https://docs.byteplus.com/en/docs/ModelArk/1330310">Model list</a> are supported in the <code>ap-southeast-1</code> region.</div>


   * <div data-tips="true" data-tips-type="tip">The seed\-2\-0 and seedream\-5\-0\-lite models are also supported in the <code>eu-west-1</code> region.</div>


* <div data-tips="true" data-tips-type="tip">Base URL by region:</div>


   * <div data-tips="true" data-tips-type="tip"><code>ap-southeast-1</code>: <code>https://ark.ap-southeast.bytepluses.com/api/v3</code></div>


   * <div data-tips="true" data-tips-type="tip"><code>eu-west-1</code>: <code>https://ark.eu-west.bytepluses.com/api/v3</code></div>



<div data-tips="true" data-tips-type="tip">For more information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191806">Region availability</a>.</div>


<span id="da0e9d90"></span>
# 1. Obtain and configure an API Key


1. Obtain an API Key: Visit [API Key management](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey) to create your API Key.

2. Add the API Key to your environment variables:

   
   <Tabs>
   <Tab zoneid="XJPeHL4wm8" title="macOS">
   <TabTitle>macOS</TabTitle>
   
   ```Bash
   export ARK_API_KEY="your_api_key_here"
   ```
   
   
   
   </Tab>
   <Tab zoneid="gK3CWzXHQZ" title="Linux">
   <TabTitle>Linux</TabTitle>
   
   ```Bash
   export ARK_API_KEY="your_api_key_here"
   ```
   
   
   
   </Tab>
   <Tab zoneid="VcmJi5yOOS" title="Windows_CMD">
   <TabTitle>Windows_CMD</TabTitle>
   
   ```Bash
   setx ARK_API_KEY "your_api_key_here"
   ```
   
   
   
   </Tab>
   <Tab zoneid="Jt7knsfqQZ" title="Windows_PowerShell">
   <TabTitle>Windows_PowerShell</TabTitle>
   
   ```PowerShell
   $env:ARK_API_KEY = "your_api_key_here"
   ```
   
   
   
   </Tab>
   </Tabs>
   


<span id="1008bfdb"></span>
# 2. Enable model services

Enable model services on the [Model activation](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement) page.

<span id="b30fecf4"></span>
# 3. Install an official or third\-party SDK

Install the SDK you need.


<Tabs>
<Tab zoneid="UU7tSExy9K" title="Python">
<TabTitle>Python</TabTitle>

> The runtime environment must have [Python](https://www.python.org/downloads/) version 3.7 or above installed.


* Install ModelArk SDK:

   ```Bash
   pip install byteplus-python-sdk-v2
   ```
   

* Install OpenAI SDK:

   ```Bash
   pip install openai
   ```
   


</Tab>
<Tab zoneid="VABlNHSfPq" title="Go">
<TabTitle>Go</TabTitle>

> The environment must have [Go](https://golang.google.cn/doc/install) version 1.18 or above installed.


Import the Go SDK in your code using the method below:

```Go
import github.com/byteplus-sdk/byteplus-go-sdk-v2
```



</Tab>
<Tab zoneid="eX0ONICXHD" title="Java">
<TabTitle>Java</TabTitle>

> The environment must have [Java](https://www.java.com/en/download/help/index_installing.html) version 1.8 or above installed.


Add the following dependency configuration to your project's `pom.xml` file.

```XML
<dependency>
  <groupId>com.byteplus</groupId>
  <artifactId>byteplus-java-sdk-v2-ark-runtime</artifactId>
  <version>LATEST</version>
</dependency>
```



</Tab>
</Tabs>


<span id="f97e77a7"></span>
# 4. Initiate an API request

<span id="b25b812a"></span>
## Text generation

Provide text input to the model to perform tasks such as question answering, analysis, rewriting, summarization, programming, translation, and more, and receive text\-based results.


<Tabs>
<Tab zoneid="E6a9tMJ3MA" title="Python">
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
    input="hello" # Replace with your prompt
    # thinking={"type": "disabled"}, #  Manually disable deep thinking
)
print(response)
```



</Tab>
<Tab zoneid="M2UhMFny3n" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
      "model": "seed-2-0-lite-260228",
      "thinking":{
          "type": "disabled"
          },
      "input": "hello"
  }'
```



* To disable deep thinking, set "thinking": {"type": "disabled"}.


</Tab>
<Tab zoneid="haJq04d53x" title="Go">
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
        // Manually disable deep thinking: &responses.ResponsesThinking{Type: responses.ThinkingType_disabled.Enum()}
    })
    if err != nil {
        fmt.Printf("response error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="HkrB8zHtNq" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        //The base URL for model invocation
        ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .input(ResponsesInput.builder().stringValue("hello").build()) // Replace with your prompt
                // Manually disable deep thinking: .thinking(ResponsesThinking.builder().type(ResponsesConstants.THINKING_TYPE_DISABLED).build())
                .build();

        ResponseObject resp = arkService.createResponse(request);
        System.out.println(resp);

        arkService.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="svDxogqjw1" title="OpenAI SDK">
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
        # Manually disable deep thinking: "thinking": {"type": "disabled"},
    },
)

print(response)
```



</Tab>
</Tabs>


For more information about text generation, see:


* [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1399009)

* [Deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1449737)

* [Migrate to Responses API](https://docs.byteplus.com/en/docs/ModelArk/1585128): Recommended for new users, offering simpler context management and robust tool integration.

* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384): A widely used and stable API.


<span id="efbfe823"></span>
## Multimodal understanding

Provide images, videos, or PDF files to the model to perform multimodal understanding tasks \- such as analysis, content moderation, question answering, and visual localization \- and receive text\-based results.


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Input |Output Preview |
|---|---|
|<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/16acff92a12f4518b1ae63b52d8b6d81~tplv-goo7wpa0wc-image.image) </span><br><br>> Based on the image, how many planets are listed in the table, and which row contains Earth? |* Reasoning: Got it, let's answer this step by step. First count the planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune. That's 8 planets total, which matches the description saying 8 planets. Then Earth is the 3rd row, after Mercury (1st) and Venus (2nd), right? Let's confirm: first row after headers is Mercury (row 1 of data), Venus (row 2), Earth is the 3rd data row (the 4th row overall in the table, including the header row)...<br><br>* Answer:<br><br>   First, there are 8 planets listed in the table, matching the description that the table covers all eight solar system planets. Earth is the third data row of the table (the fourth full table row, if you count the column header row as the first row), it sits between the Venus row and the Mars row, with its volume (Earth=1) marked as 1.00, and its distance from the Sun as 149.6 million km. |



<Tabs>
<Tab zoneid="JJ3uSRLGVv" title="Python">
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
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
<Tab zoneid="FvfKF5hn6C" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
-H "Authorization: Bearer $ARK_API_KEY" \\
-H 'Content-Type: application/json' \\
-d '{
    "model": "seed-2-0-lite-260228",
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                }
            ]
        }
    ]
}'
```



</Tab>
<Tab zoneid="QfS87gBKR1" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"    
    "github.com/samber/lo"
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

    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Image{
                    Image: &responses.ContentItemImage{
                        Type:     responses.ContentItemType_input_image,
                        ImageUrl: lo.ToPtr("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                    },
                },
            },
        },
    }

    resp, err := client.CreateResponses(ctx, &responses.ResponsesRequest{
        Model: "seed-2-0-lite-260228",
        Input: &responses.ResponsesInput{
            Union: &responses.ResponsesInput_ListValue{
                ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{
                    Union: &responses.InputItem_InputMessage{
                        InputMessage: inputMessage,
                    },
                }}},
            },
        },
    })
    if err != nil {
        fmt.Printf("response error: %v\n", err)
        return
    }
    fmt.Println(resp)
}
```



</Tab>
<Tab zoneid="Gy4li7Go92" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.content.*;
import com.byteplus.ark.runtime.model.responses.item.*;
import com.byteplus.ark.runtime.model.responses.response.ResponseObject;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;

public class demo {
  public static void main(String[] args) {
    String apiKey = System.getenv("ARK_API_KEY");
    ArkService arkService = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3")
        .build();

    CreateResponsesRequest request = CreateResponsesRequest.builder()
        .model("seed-2-0-lite-260228")
        .input(ResponsesInput.builder().addListItem(
            ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                MessageContent.builder()
                    .addListItem(InputContentItemImage.builder()
                        .imageUrl("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png").build())
                    .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth?").build())
                    .build())
                .build())
            .build())
        .build();
    ResponseObject resp = arkService.createResponse(request);
    System.out.println(resp);

    arkService.shutdownExecutor();
  }
}
```



</Tab>
<Tab zoneid="SicRBWHpBE" title="OpenAI SDK">
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
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/planet_comparison.png"
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                },
            ],
        }
    ]
)

print(response)
```



</Tab>
</Tabs>



* Multi\-modal understanding: See [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1362931), [Video understanding](https://docs.byteplus.com/en/docs/ModelArk/1895586) and [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1902647) for details.

* [Visual grounding](https://docs.byteplus.com/en/docs/ModelArk/1616136): Task to find the corresponding target in the image and return coordinates.

* [Files API tutorial](https://docs.byteplus.com/en/docs/ModelArk/1885708): Interfaces for uploading images, videos, and documents.


<span id="d481ca5b"></span>
## Image generation

Provide images or text to the model to generate images for advertisements, posters, and image sets; perform image editing tasks such as adding or modifying elements and changing colors; and apply style transformations such as ink or watercolor effects.


<span aceTableMode="list" aceTableWidth="1,2"></span>
|Prompt |Output Preview |
|---|---|
|Vibrant close\-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot in medium format, dramatic studio lighting. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/00fb66006eb84b16965b620b6e1f2d78~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="wpBMun54Ng" title="Python">
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
 
imagesResponse = client.images.generate( 
    #Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot in medium format, dramatic studio lighting.",
    size="2K",
    response_format="url",
    watermark=False
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
<Tab zoneid="vbgC9A7M34" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
    "size": "2K",
    "watermark": false
}'
```



</Tab>
<Tab zoneid="zi12zTHWS8" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
// Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
                
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                .model("seedream-5-0-260128") //Replace with Model ID
                .prompt("Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.")
                .size("2K")
                .sequentialImageGeneration("disabled")
                .responseFormat(ResponseFormat.Url)
                .stream(false)
                .watermark(false)
                .build();
        ImagesResponse imagesResponse = service.generateImages(generateRequest);
        System.out.println(imagesResponse.getData().get(0).getUrl());

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="fx70qi2UfR" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "strings"    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(        
        os.Getenv("ARK_API_KEY"), // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"), //The base URL for model invocation
    )    
    ctx := context.Background()

    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128", //Replace with Model ID
       Prompt:         "Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
       Size:           byteplus.String("2K"),
       ResponseFormat: byteplus.String(model.GenerateImagesResponseFormatURL),
       Watermark:      byteplus.Bool(false),
    }

    imagesResponse, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
       fmt.Printf("generate images error: %v\\n", err)
       return
    }

    fmt.Printf("%s\\n", *imagesResponse.Data[0].Url)
}
```



</Tab>
<Tab zoneid="tbk6AmuCHv" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(     
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", #The base URL for model invocation    
    api_key=os.getenv('ARK_API_KEY'),  # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
) 
 
imagesResponse = client.images.generate( 
    #Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
    size="2K",
    response_format="url",
    extra_body={
        "watermark": false,
    },
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
</Tabs>



* [Seedream 4.0-5.0 tutorial](https://docs.byteplus.com/en/docs/ModelArk/1824121): An overview of mainstream image generation model capabilities and API tutorial.

* [Seedream 4.0-4.5 prompt guide](https://docs.byteplus.com/en/docs/ModelArk/1829186)


<span id="18692b80"></span>
## Video generation

Quickly generate high\-quality video content in diverse visual styles based on text descriptions and image inputs.


<span aceTableMode="list" aceTableWidth="1,2"></span>
|Prompt |Output Preview |
|---|---|
|Photorealistic style: Under a clear blue sky, a vast expanse of white daisy fields stretches out. The camera gradually zooms in and finally fixates on a close\-up of a single daisy, with several glistening dewdrops resting on its petals. |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/62699e55f1674309b6692d188c9ed492" controls></video><br> |



<Tabs>
<Tab zoneid="AIW8IDM34Z" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time  
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(    
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", #The base URL for model invocation    
    api_key=os.environ.get("ARK_API_KEY"), # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", #Replace with Model ID 
        content=[
            {
                # Combination of text prompt and parameters
                "type": "text",
                "text": "Photorealistic style: Under a clear blue sky, a vast expanse of white daisy fields stretches out. The camera gradually zooms in and finally fixates on a close - up of a single daisy, with several glistening dewdrops resting on its petals.  --ratio 16:9  --resolution 720p  --duration 5 --camerafixed false"
            }
        ]
    )
    print(create_result)

    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 3 seconds...")
            time.sleep(3)
```



</Tab>
<Tab zoneid="lD7pViqofA" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;

public class ContentGenerationTaskExample {
  public static void main(String[] args) {
    String apiKey = System.getenv("ARK_API_KEY");
    ArkService service = ArkService.builder()
        .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
        .apiKey(apiKey)
        .build();

    System.out.println("----- create request -----");
    List<Content> contents = new ArrayList<>();
    contents.add(Content.builder()
        .type("text")
        .text("Photorealistic style: Under a clear blue sky, a vast expanse of white daisy fields stretches out. The camera gradually zooms in and finally fixates on a close - up of a single daisy, with several glistening dewdrops resting on its petals.  --ratio 16:9  --resolution 720p  --duration 5 --camerafixed false")        
        .build());

    // Create a video generation task
    CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
        .model("dreamina-seedance-2-0-260128") //Replace with Model ID
        .content(contents)
        .build();

    CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
    System.out.println(createResult);

    // Get the details of the task
    String taskId = createResult.getId();
    GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
        .taskId(taskId)
        .build();

    System.out.println("----- polling task status -----");
    while (true) {
      try {
        GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
        String status = getResponse.getStatus();
        if ("succeeded".equalsIgnoreCase(status)) {
          System.out.println("----- task succeeded -----");
          System.out.println(getResponse);
          service.shutdownExecutor();
          break;
        } else if ("failed".equalsIgnoreCase(status)) {
          System.out.println("----- task failed -----");
          System.out.println("Error: " + getResponse.getStatus());
          service.shutdownExecutor();
          break;
        } else {
          System.out.printf("Current status: %s, Retrying in 3 seconds...\n", status);
          TimeUnit.SECONDS.sleep(3);
        }
      } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        System.err.println("Polling interrupted");
        service.shutdownExecutor();
        break;
      }
    }
  }
}
```



</Tab>
<Tab zoneid="XiFbX8vu25" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(        
        os.Getenv("ARK_API_KEY"), // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"), //The base URL for model invocation
    )
    ctx := context.Background()
    //Replace with Model ID
    modelEp := "dreamina-seedance-2-0-260128"

    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model: modelEp,
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String("Photorealistic style: Under a clear blue sky, a vast expanse of white daisy fields stretches out. The camera gradually zooms in and finally fixates on a close - up of a single daisy, with several glistening dewdrops resting on its petals.  --ratio 16:9  --resolution 720p  --duration 5 --camerafixed false"), 
            },
        },
    }
    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v", err)
        return
    }
    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s", taskID)

    // Polling query section
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 3 seconds... \\n", status)
            time.Sleep(3 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>



* [Video generation tutorial](https://docs.byteplus.com/en/docs/ModelArk/2298881): Learn how to use the model’s video generation capabilities, including text\-to\-video, first\-frame video generation, and first\-and\-last\-frame video generation.

* [Dreamina Seedance 2.0 series prompt guide](https://docs.byteplus.com/en/docs/ModelArk/2222480)


<span id="086a3233"></span>
## Tools

Enable the model to access external data and functions through tools or plugins, including:


* Custom tools: Tools that you define and develop yourself. See [Function calling](https://docs.byteplus.com/en/docs/ModelArk/1262342) for details.

* Third\-party tools: External tools that are compatible with the MCP protocol. See [Cloud-deployed MCP / remote MCP](https://docs.byteplus.com/en/docs/ModelArk/InfoQuest) for details.

    &nbsp;


<span id="step-5-next-steps"></span>
# Step 5: Next steps

Visit the [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) page to quickly browse all models provided by ModelArk and select the ones that best fit your scenarios.



