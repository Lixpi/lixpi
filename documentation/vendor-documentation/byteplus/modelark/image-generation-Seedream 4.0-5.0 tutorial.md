seedream\-5\-0\-lite, seedream\-4\-5 and seedream\-4\-0 models natively support text, single\-image, and multi\-image inputs, enabling diverse workflows such as multi\-image fusion based on subject consistency, image editing, and batch image generation. This provides creators with greater flexibility and control over the image\-creation process.

This document uses seedream\-5\-0\-lite as an example to illustrate how to use [Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523) for image creation. To use the seedream\-4\-5 and seedream\-4\-0 models, replace the model field in the code samples below.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>Region availability</strong>: seedream\-5\-0\-lite is supported in both the <code>ap-southeast-1</code> and <code>eu-west-1</code> regions.</div>


* <div data-tips="true" data-tips-type="tip">Base URL by region:</div>


   * <div data-tips="true" data-tips-type="tip"><code>ap-southeast-1</code>: <code>https://ark.ap-southeast.bytepluses.com/api/v3</code></div>


   * <div data-tips="true" data-tips-type="tip"><code>eu-west-1</code>: <code>https://ark.eu-west.bytepluses.com/api/v3</code></div>



<div data-tips="true" data-tips-type="tip">For more information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191806">Region availability</a>.</div>


<span id="2cf5cace"></span>
# Showcases


<span aceTableMode="list" aceTableWidth="4,3,3"></span>
|Use cases |Input |Output |
|---|---|---|
|Multi\-reference image\-to\-image generation<br><br>&nbsp;<br><br>\> Input multiple images as reference, blend styles and elements to generate new images |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2198d4bef000400bbfea18025850ed82~tplv-goo7wpa0wc-image.image) </span><br><br>\> Replace the clothing in image 1 with the outfit from image 2. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/94fa391195e248fbb709691892ea7eb9~tplv-goo7wpa0wc-image.image) </span> |
|Image sequence generation<br><br>\> Based on text and images entered by the user, generate a set of content\-related images |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a215e8241dd94f50901948790da121e1~tplv-goo7wpa0wc-image.image) </span><br><br>\> Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops |<span>![图片](https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/uz4ozCg6b_fy7XwYvWRLa.jpeg) </span> |


<span id="9278b81b"></span>
# Model capabilities


<span aceTableMode="list" aceTableWidth="1.5,2,3,3,3"></span>
|Model Name ||[seedream-5-0-lite](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0) |[seedream-4-5](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-5) |[seedream-4-0](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-0) |
|---|---|---|---|---|
|Model ID ||seedream\-5\-0\-260128 (also supports: seedream\-5\-0\-lite\-260128) |seedream\-4\-5\-251128 |seedream\-4\-0\-250828 |
|Text to image ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |
|Text to grouped images ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |
|Single / Multi image to image ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |
|Single / Multi image to grouped images ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |
|Streaming output ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |
|Web search ||<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/733f5c4e2c954d0f9f25c47e91c7fc9d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1907ef06afcb468ab116acf4b16c972d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1907ef06afcb468ab116acf4b16c972d~tplv-goo7wpa0wc-image.image) </span> |
|Model parameters |Resolution |2K, 3K, 4K |2K, 4K |1K, 2K, 4K |
||Output format |png, jpeg |jpeg |jpeg |
||Prompt optimization mode |standard mode |standard mode |standard mode, fast mode |
||Number of generated images |Number of input reference images + Number of generated images ≤ 15. | | |
|Max Images per Minute ||500 |500 |500 |


<span id="88612aa1"></span>
# Prerequisites

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="386b6ea2"></span>
# Quick start

You can try the image generation feature on the ModelArk platform using [API Explorer](https://api.byteplus.com/api-explorer/?action=ImageGenerations&groupName=Image%20Generation%20API&serviceCode=ark&version=2024-01-01), It supports custom parameters configuration (e.g. watermark settings, output image size), and effect & performance evaluation.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2eea8e183d5d424cbd1f707bef9351d1~tplv-goo7wpa0wc-image.image) </span>

<span id="e36d7d78"></span>
# Basic usage

<span id="9695d195"></span>
## Text\-to\-image (text Input, single\-image output)

Provide clear and accurate text instructions to the model to quickly generate a high\-quality image that matches the description.


<span aceTableMode="list" aceTableWidth="4,2"></span>
|Prompt |Output |
|---|---|
|Vibrant close\-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot in medium format, dramatic studio lighting. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/512e8df7233f486389cbd5a6ac1e4e59~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="RV56HGWiwy" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="jFONh7gleF" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
    size="2K",
    output_format="png",
    response_format="url",
    watermark=False
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
<Tab zoneid="WZ0Bm9zkY4" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
                
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                .model("seedream-5-0-260128") // Replace with Model ID
                .prompt("Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.")
                .size("2K")
                .sequentialImageGeneration("disabled")
                .outputFormat("png")
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
<Tab zoneid="XiMApVetVB" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    

    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128", // Replace with Model ID
       Prompt:         "Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
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
<Tab zoneid="P2V0vgXfcj" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Vibrant close-up editorial portrait, model with piercing gaze, wearing a sculptural hat, rich color blocking, sharp focus on eyes, shallow depth of field, Vogue magazine cover aesthetic, shot on medium format, dramatic studio lighting.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "watermark": False,
    },
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
</Tabs>


<span id="8bc49063"></span>
## Image\-to\-image (single\-image input, single\-image output)

Edit an existing image using text instructions, including adding or removing elements, changing style or texture, adjusting color tone, and modifying the background, perspective, or size.


<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|Prompt |Input image |Output |
|---|---|---|
|Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid, the model's skin details are visible. Lighting changes from reflection to refraction. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/816153e67d3c4478886276154d78b22e~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3ce782f3fea14b099103be608a78fe43~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="OmEODHKOjr" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid water, the model's skin details are visible. Lighting changes from reflection to refraction.",
    "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imageToimage.png",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="RnUCs9xjbh" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
)
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128", 
    prompt="Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid water, the model's skin details are visible. Lighting changes from reflection to refraction.",
    image="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imageToimage.png",
    size="2K",
    output_format="png",
    response_format="url",
    watermark=False
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
<Tab zoneid="w6mT3s28TX" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();

        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                .model("seedream-5-0-260128") // Replace with Model ID
                .prompt("Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid water, the model's skin details are visible. Lighting changes from reflection to refraction.")
                .image("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imageToimage.png")
                .size("2K")
                .sequentialImageGeneration("disabled")
                .outputFormat("png")
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
<Tab zoneid="TRAHOOFkuO" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG

    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid water, the model's skin details are visible. Lighting changes from reflection to refraction.",
       Image:          byteplus.String("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imageToimage.png"),
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
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
<Tab zoneid="EuwjV0ZOpg" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 

imagesResponse = client.images.generate( 
    model="seedream-5-0-260128",
    prompt="Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water (or glass). Through the liquid water, the model's skin details are visible. Lighting changes from reflection to refraction.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body = {
        "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imageToimage.png",
        "watermark": False
    }
) 

print(imagesResponse.data[0].url)
```



</Tab>
</Tabs>


<span id="4a35e28f"></span>
## Multi\-image blending (multi\-image input, single\-image output)

Generate a new image by blending styles and visual elements from your prompt and multiple reference images. For example, you can merge clothing, shoes, and accessories with model photos to create outfit images, or combine people with landscapes to produce portrait scenes.


<span aceTableMode="list" aceTableWidth="2,3,3,3"></span>
|Prompt |Input image 1 |Input image 2 |Output |
|---|---|---|---|
|Replace the clothing in image 1 with the outfit from image 2. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4b4464161cf3463db6f9463b10939178~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c23d1b0528a14cb08b684307eabdcc9b~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/94fa391195e248fbb709691892ea7eb9~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="apiWKMp7mA" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Replace the clothing in image 1 with the outfit from image 2.",
    "image": ["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimage_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imagesToimage_2.png"],
    "sequential_image_generation": "disabled",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="OYTK9qEnHG" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Replace the clothing in image 1 with the outfit from image 2.",
    image=["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimage_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imagesToimage_2.png"],
    size="2K",
    sequential_image_generation="disabled",
    output_format="png",
    response_format="url",
    watermark=False
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
<Tab zoneid="M4UPQAbmNX" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();

        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                .model("seedream-5-0-260128") // Replace with Model ID
                .prompt("Replace the clothing in image 1 with the outfit from image 2.")
                .image(Arrays.asList(
                    "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimage_1.png",
                    "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imagesToimage_2.png"
                ))
                .size("2K")
                .sequentialImageGeneration("disabled")
                .outputFormat("png")
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
<Tab zoneid="T0lLj53SbZ" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG

    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Replace the clothing in image 1 with the outfit from image 2.",
       Image:         []string{
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimage_1.png",
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imagesToimage_2.png",
       },
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
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
<Tab zoneid="IgZXgJNAy3" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    model="seedream-5-0-260128",
    prompt="Replace the clothing in image 1 with the outfit from image 2.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body = {
        "image": ["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimage_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_5_imagesToimage_2.png"],
        "watermark": False,
        "sequential_image_generation": "disabled",
    }
) 
 
print(imagesResponse.data[0].url)
```



</Tab>
</Tabs>


<span id="b4da5e23"></span>
## Batch image output

Generate a set of thematically related images—such as comic storyboards or brand visuals—using one or more images combined with text descriptions.

Specify the parameter **sequential_image_generation** as `auto`.

<span id="b5f76bc7"></span>
### Text\-to\-batch\-image (text input, batch\-image output)


<span aceTableMode="list" aceTableWidth="2,1"></span>
|Prompt |Output (four pictures will be generated) |
|---|---|
|Generate a set of four cinematic sci\-fi realistic film storyboard scenes:<br><br>Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim\-lit by side\-backlighting, cool\-toned sci\-fi lighting with space station lights accenting the scene, a zero\-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere.<br><br>Scene 2: Suddenly hit by a meteorite belt. Wide\-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light\-shadow contrast. Intense disaster atmosphere with powerful visual impact.<br><br>Scene 3: The astronaut dodges urgently. Close\-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter.<br><br>Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium\-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d745adde44954b859f6603a799948726~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="dFQR66Yag8" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Generate a set of four cinematic sci-fi realistic film storyboard scenes:Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim-lit by side-backlighting, cool-toned sci-fi lighting with space station lights accenting the scene, a zero-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere. Scene 2: Suddenly hit by a meteorite belt. Wide-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light-shadow contrast. Intense disaster atmosphere with powerful visual impact. Scene 3: The astronaut dodges urgently. Close-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter. Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity.",
    "size": "2K",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 4
    },
    "stream": false,
    "output_format":"png",
    "response_format": "url",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="tPl1XyJA8W" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 
from byteplussdkarkruntime.types.images.images import SequentialImageGenerationOptions

client = Ark(
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128", 
    prompt="Generate a set of four cinematic sci-fi realistic film storyboard scenes:Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim-lit by side-backlighting, cool-toned sci-fi lighting with space station lights accenting the scene, a zero-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere. Scene 2: Suddenly hit by a meteorite belt. Wide-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light-shadow contrast. Intense disaster atmosphere with powerful visual impact. Scene 3: The astronaut dodges urgently. Close-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter. Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity.",
    size="2K",
    sequential_image_generation="auto",
    sequential_image_generation_options=SequentialImageGenerationOptions(max_images=4),
    output_format="png",
    response_format="url",
    watermark=False
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
<Tab zoneid="XquAAIVpHL" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
        
        GenerateImagesRequest.SequentialImageGenerationOptions sequentialImageGenerationOptions = new GenerateImagesRequest.SequentialImageGenerationOptions();
        sequentialImageGenerationOptions.setMaxImages(4);
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                 .model("seedream-5-0-260128")  // Replace with Model ID
                 .prompt("Generate a set of four cinematic sci-fi realistic film storyboard scenes:Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim-lit by side-backlighting, cool-toned sci-fi lighting with space station lights accenting the scene, a zero-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere. Scene 2: Suddenly hit by a meteorite belt. Wide-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light-shadow contrast. Intense disaster atmosphere with powerful visual impact. Scene 3: The astronaut dodges urgently. Close-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter. Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity.")
                 .size("2K")
                 .sequentialImageGeneration("auto")
                 .sequentialImageGenerationOptions(sequentialImageGenerationOptions)
                 .outputFormat("png")
                 .responseFormat(ResponseFormat.Url)
                 .stream(false)
                 .watermark(false)
                 .build();
        ImagesResponse imagesResponse = service.generateImages(generateRequest);
        // Iterate through all image data
        if (imagesResponse != null && imagesResponse.getData() != null) {
            for (int i = 0; i < imagesResponse.getData().size(); i++) {
                // Retrieve image information
                String url = imagesResponse.getData().get(i).getUrl();
                String size = imagesResponse.getData().get(i).getSize();
                System.out.printf("Image %d:%n", i + 1);
                System.out.printf("  URL: %s%n", url);
                System.out.printf("  Size: %s%n", size);
                System.out.println();
            }


            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="mG3DRZqYGa" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    var sequentialImageGeneration model.SequentialImageGeneration = "auto"
    maxImages := 4
    
    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Generate a set of four cinematic sci-fi realistic film storyboard scenes:Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim-lit by side-backlighting, cool-toned sci-fi lighting with space station lights accenting the scene, a zero-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere. Scene 2: Suddenly hit by a meteorite belt. Wide-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light-shadow contrast. Intense disaster atmosphere with powerful visual impact. Scene 3: The astronaut dodges urgently. Close-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter. Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity.",
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
       Watermark:      byteplus.Bool(false),
       SequentialImageGeneration: &sequentialImageGeneration,
       SequentialImageGenerationOptions: &model.SequentialImageGenerationOptions{
          MaxImages: &maxImages,
       },
    }

    resp, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
        fmt.Printf("call GenerateImages error: %v\\n", err)
        return
    }

    if resp.Error != nil {
        fmt.Printf("API returned error: %s - %s\\n", resp.Error.Code, resp.Error.Message)
        return
    }

    // Output the generated image information
    fmt.Printf("Generated %d images:\\n", len(resp.Data))
    for i, image := range resp.Data {
        var url string
        if image.Url != nil {
            url = *image.Url
        } else {
            url = "N/A"
        }
        fmt.Printf("Image %d: Size: %s, URL: %s\\n", i+1, image.Size, url)
    }
}
```



</Tab>
<Tab zoneid="IxTYMBFV9N" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    model="seedream-5-0-260128",
    prompt="Generate a set of four cinematic sci-fi realistic film storyboard scenes:Scene 1: An astronaut repairs a spacecraft at a space station, featuring intricate external mechanical structures, a deep starry sky + Milky Way background. The astronaut wears a highly detailed white spacesuit, holds professional repair tools, and focuses on inspecting the spacecraft's exterior. Medium full shot, rim-lit by side-backlighting, cool-toned sci-fi lighting with space station lights accenting the scene, a zero-gravity environment, exquisite metallic textures, and a serene yet precise atmosphere. Scene 2: Suddenly hit by a meteorite belt. Wide-angle epic shot, with numerous meteorites of varying sizes rushing in at high speed. The meteorite surfaces are sharply textured, with burning tails, motion blur emphasizing speed, and an overwhelming sense of pressure. The spacecraft and space station are positioned on one side of the frame, with the dark, deep space background creating strong light-shadow contrast. Intense disaster atmosphere with powerful visual impact. Scene 3: The astronaut dodges urgently. Close-up dynamic capture, showing the astronaut in zero gravity swiftly twisting to avoid impact, with full dynamic tension in their posture. They reach out to grab a fixed handrail, with meteorites streaking past in the background. Slight camera shake enhances the sense of immediacy. Details like spacesuit creases and tubing are clearly visible. Tense and urgent, with cold, sharp lighting and a focused subject without clutter. Scene 4: The astronaut, injured, escapes back to the spacecraft in a thrilling sequence. Medium-close narrative shot. The astronaut's spacesuit shows minor abrasions and scratches, looking slightly disheveled yet determined, stumbling toward the open spacecraft hatch. The warm interior light contrasts with the cold light of space, with meteorites fading into the background. A tense escape atmosphere, with realistic details and full emotional intensity.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {
            "max_images": 4
        },
    },
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
</Tabs>


<span id="a80c411f"></span>
### Image\-to\-batch\-image (single\-image input, batch\-image output)


<span aceTableMode="list" aceTableWidth="4,2,2"></span>
|Prompt |Input image |Output (four pictures will be generated) |
|---|---|---|
|Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c724450228a94a909580c0400fbf503b~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9444f4bb109145ad95b4de7596407af6~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="hSgRGo6Iml" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style.",
    "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages.png",
    "size": "2K",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 4
    },
    "stream": false,
    "output_format":"png",
    "response_format": "url",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="Cwdd4y3vMC" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 
from byteplussdkarkruntime.types.images.images import SequentialImageGenerationOptions

client = Ark(
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    # Replace with Model ID .
    model="seedream-5-0-260128",
    prompt="Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style.",
    image="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages.png",
    size="2K",
    sequential_image_generation="auto",
    sequential_image_generation_options=SequentialImageGenerationOptions(max_images=4),
    output_format="png",
    response_format="url",
    watermark=False
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
<Tab zoneid="Ofa8UXSfvm" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
        
        GenerateImagesRequest.SequentialImageGenerationOptions sequentialImageGenerationOptions = new GenerateImagesRequest.SequentialImageGenerationOptions();
        sequentialImageGenerationOptions.setMaxImages(4);
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                 .model("seedream-5-0-260128") // Replace with Model ID
                 .prompt("Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style.")
                 .image("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages.png")
                 .size("2K")
                 .sequentialImageGeneration("auto")
                 .sequentialImageGenerationOptions(sequentialImageGenerationOptions)
                 .outputFormat("png")
                 .responseFormat(ResponseFormat.Url)
                 .stream(false)
                 .watermark(false)
                 .build();
        ImagesResponse imagesResponse = service.generateImages(generateRequest);
        // Iterate through all image data
        if (imagesResponse != null && imagesResponse.getData() != null) {
            for (int i = 0; i < imagesResponse.getData().size(); i++) {
                // Retrieve image information
                String url = imagesResponse.getData().get(i).getUrl();
                String size = imagesResponse.getData().get(i).getSize();
                System.out.printf("Image %d:%n", i + 1);
                System.out.printf("  URL: %s%n", url);
                System.out.printf("  Size: %s%n", size);
                System.out.println();
            }


            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="s3FfANCwfm" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    var sequentialImageGeneration model.SequentialImageGeneration = "auto"
    maxImages := 4
    
    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style.",
       Image:          byteplus.String("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages.png"),
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
       Watermark:      byteplus.Bool(false),
       SequentialImageGeneration: &sequentialImageGeneration,
       SequentialImageGenerationOptions: &model.SequentialImageGenerationOptions{
          MaxImages: &maxImages,
       },
    }

    resp, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
        fmt.Printf("call GenerateImages error: %v\\n", err)
        return
    }

    if resp.Error != nil {
        fmt.Printf("API returned error: %s - %s\\n", resp.Error.Code, resp.Error.Message)
        return
    }

    // Output the generated image information
    fmt.Printf("Generated %d images:\\n", len(resp.Data))
    for i, image := range resp.Data {
        var url string
        if image.Url != nil {
            url = *image.Url
        } else {
            url = "N/A"
        }
        fmt.Printf("Image %d: Size: %s, URL: %s\\n", i+1, image.Size, url)
    }
}
```



</Tab>
<Tab zoneid="gb44Fin56H" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    model="seedream-5-0-260128", 
    prompt="Using this LOGO as a reference, create a visual design system for an outdoor sports brand named GREEN, including packaging bags, hats, cards, lanyards, etc. Main visual tone is green, with a fun, simple, and modern style.", 
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages.png",
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {
            "max_images": 4
        },
    }   
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
</Tabs>


<span id="ef168e47"></span>
### Multi\-image\-to\-batch\-image (multi\-image input, batch\-image output)


<span aceTableMode="list" aceTableWidth="4,2,2,2"></span>
|Prompt |Input image 1 |Input image 2 |Output (three images will be generated) |
|---|---|---|---|
|Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/77024d8e03f24862b066bfc385301120~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2cbc5cf5a68d44899fc52f177fb9cf51~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/79f02de3dbaa4b5f9767b91c3fee0471~tplv-goo7wpa0wc-image.image) </span> |



<Tabs>
<Tab zoneid="B4wIZPpuTo" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night.",
    "image": ["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_2.png"],
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 3
    },
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="JsCdFW6eGX" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2 .
from byteplussdkarkruntime import Ark 
from byteplussdkarkruntime.types.images.images import SequentialImageGenerationOptions

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="seedream-5-0-260128",
    prompt="Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night.",
    image=["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_2.png"],
    size="2K",
    sequential_image_generation="auto",
    sequential_image_generation_options=SequentialImageGenerationOptions(max_images=3),
    output_format="png",
    response_format="url",
    watermark=False
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
<Tab zoneid="B07Rlerdn2" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();

        GenerateImagesRequest.SequentialImageGenerationOptions sequentialImageGenerationOptions = new GenerateImagesRequest.SequentialImageGenerationOptions();
        sequentialImageGenerationOptions.setMaxImages(3);
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                 .model("seedream-5-0-260128") // Replace with Model ID
                 .prompt("Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night.")
                 .image(Arrays.asList(
                     "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_1.png",
                     "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_2.png"
                 ))
                 .outputFormat("png")
                 .size("2K")
                 .sequentialImageGeneration("auto")
                 .sequentialImageGenerationOptions(sequentialImageGenerationOptions)
                 
                 .responseFormat(ResponseFormat.Url)
                 .stream(false)
                 .watermark(false)
                 .build();
        ImagesResponse imagesResponse = service.generateImages(generateRequest);

        // Iterate through all image data
        if (imagesResponse != null && imagesResponse.getData() != null) {
            for (int i = 0; i < imagesResponse.getData().size(); i++) {
                // Retrieve image information
                String url = imagesResponse.getData().get(i).getUrl();
                String size = imagesResponse.getData().get(i).getSize();
                System.out.printf("Image %d:%n", i + 1);
                System.out.printf("  URL: %s%n", url);
                System.out.printf("  Size: %s%n", size);
                System.out.println();
            }


            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="j4biDXesRS" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    var sequentialImageGeneration model.SequentialImageGeneration = "auto"
    maxImages := 3
    
    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night.",
       Image:         []string{
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_1.png",
           "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_2.png",
       },

       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
       Watermark:      byteplus.Bool(false),
       SequentialImageGeneration: &sequentialImageGeneration,
       SequentialImageGenerationOptions: &model.SequentialImageGenerationOptions{
          MaxImages: &maxImages,
       },
    }

    resp, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
        fmt.Printf("call GenerateImages error: %v\\n", err)
        return
    }

    if resp.Error != nil {
        fmt.Printf("API returned error: %s - %s\\n", resp.Error.Code, resp.Error.Message)
        return
    }

    // Output the generated image information
    fmt.Printf("Generated %d images:\\n", len(resp.Data))
    for i, image := range resp.Data {
        var url string
        if image.Url != nil {
            url = *image.Url
        } else {
            url = "N/A"
        }
        fmt.Printf("Image %d: Size: %s, URL: %s\\n", i+1, image.Size, url)
    }
}
```



</Tab>
<Tab zoneid="WMPBRGUxyz" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    model="seedream-5-0-260128", 
    prompt="Generate 3 images of a girl and a cow plushie happily riding a roller coaster in an amusement park, depicting morning, noon, and night.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "image": ["https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_1.png", "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imagesToimages_2.png"],
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {
            "max_images": 3
        },
    }   
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
</Tabs>


<span id="9971b247"></span>
## **Prompt recommendations**


* Use coherent natural language to describe the **subject + action + environment**. If aesthetics matter, include descriptors of **style,**  **color,**  **lighting,**  or **composition**. For details, see [Seedream 4.0-4.5 prompt guide](https://docs.byteplus.com/en/docs/ModelArk/1829186).

* Keep text prompts under 600 English words. Very long prompts may scatter the information, causing the model to overlook details and focus only on key points, which can result in missing elements in the generated image.


<span id="4d900593"></span>
# Advanced usage

<span id="914db3a9"></span>
## Streaming output

seedream\-5\-0\-lite, seedream\-4\-5 and seedream\-4\-0 models support streaming image generation. Results are returned as soon as an image is created, enabling faster browsing and improving end\-user experience.

Enable streaming output mode by setting the **stream** parameter to `true`.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3a6bf2b6c3f0493e8eef28e76ce62784~tplv-goo7wpa0wc-image.image) </span>


<Tabs>
<Tab zoneid="RosYyb7WmA" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "seedream-5-0-260128",
    "prompt": "Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops",
    "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages_1.png",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 4
    },
    "size": "2K",
    "stream": true,
    "output_format":"png",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="uMdVyXlcrp" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 
from byteplussdkarkruntime.types.images.images import SequentialImageGenerationOptions

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 

if __name__ == "__main__":
    stream = client.images.generate(
        # Replace with Model ID
        model="seedream-5-0-260128",
        prompt="Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops",
        image="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages_1.png",
        size="2K",
        sequential_image_generation="auto",
        sequential_image_generation_options=SequentialImageGenerationOptions(max_images=4),
        output_format="png",
        response_format="url",
        stream=True,
        watermark=False
    )
    for event in stream:
        if event is None:
            continue
        if event.type == "image_generation.partial_failed":
            print(f"Stream generate images error: {event.error}")
            if event.error is not None and event.error.code.equal("InternalServiceError"):
                break
        elif event.type == "image_generation.partial_succeeded":
            if event.error is None and event.url:
                print(f"recv.Size: {event.size}, recv.Url: {event.url}")
        elif event.type == "image_generation.completed":
            if event.error is None:
                print("Final completed event:")
                print("recv.Usage:", event.usage)
        elif event.type == "image_generation.partial_image":
            print(f"Partial image index={event.partial_image_index}, size={len(event.b64_json)}")
```



</Tab>
<Tab zoneid="AtkrEZcJAe" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
        
        GenerateImagesRequest.SequentialImageGenerationOptions sequentialImageGenerationOptions = new GenerateImagesRequest.SequentialImageGenerationOptions();
        sequentialImageGenerationOptions.setMaxImages(4);
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                 .model("seedream-5-0-260128") //Replace with Model ID .
                 .prompt("Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops")
                 .image("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages_1.png")
                 .size("2K")
                 .sequentialImageGeneration("auto")
                 .sequentialImageGenerationOptions(sequentialImageGenerationOptions)
                 .outputFormat("png")
                 .responseFormat(ResponseFormat.Url)
                 .stream(true)
                 .watermark(false)
                 .build();
        
        service.streamGenerateImages(generateRequest)
                .doOnError(Throwable::printStackTrace)
                .blockingForEach(
                        choice -> {
                            if (choice == null) return;
                            if ("image_generation.partial_failed".equals(choice.getType())) {
                                if (choice.getError() != null) {
                                    System.err.println("Stream generate images error: " + choice.getError());
                                    if (choice.getError().getCode() != null && choice.getError().getCode().equals("InternalServiceError")) {
                                        throw new RuntimeException("Server error, terminating stream.");
                                    }
                                }
                            }
                            else if ("image_generation.partial_succeeded".equals(choice.getType())) {
                                if (choice.getError() == null && choice.getUrl() != null && !choice.getUrl().isEmpty()) {
                                    System.out.printf("recv.Size: %s, recv.Url: %s%n", choice.getSize(), choice.getUrl());
                                }
                            }
                            else if ("image_generation.completed".equals(choice.getType())) {
                                if (choice.getError() == null && choice.getUsage() != null) {
                                    System.out.println("recv.Usage: " + choice.getUsage().toString());
                                }
                            }
                        }
                );
        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="lu4ytYHlGZ" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "strings"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    var sequentialImageGeneration model.SequentialImageGeneration = "auto"
    maxImages := 4
    
    generateReq := model.GenerateImagesRequest{
       Model:          "seedream-5-0-260128",
       Prompt:         "Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops",
       Image:          byteplus.String("https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages_1.png"),
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
       Watermark:      byteplus.Bool(false),
       SequentialImageGeneration: &sequentialImageGeneration,
       SequentialImageGenerationOptions: &model.SequentialImageGenerationOptions{
          MaxImages: &maxImages,
       },
    }
    
    stream, err := client.GenerateImagesStreaming(ctx, generateReq)
    if err != nil {
       fmt.Printf("call GenerateImagesStreaming error: %v\\n", err)
       return
    }
    defer stream.Close()
    for {
       recv, err := stream.Recv()
       if err == io.EOF {
          break
       }
       if err != nil {
          fmt.Printf("Stream generate images error: %v\\n", err)
          break
       }
       if recv.Type == "image_generation.partial_failed" {
          fmt.Printf("Stream generate images error: %v\\n", recv.Error)
          if strings.EqualFold(recv.Error.Code, "InternalServiceError") {
             break
          }
       }
       if recv.Type == "image_generation.partial_succeeded" {
          if recv.Error == nil && recv.Url != nil {
             fmt.Printf("recv.Size: %s, recv.Url: %s\\n", recv.Size, *recv.Url)
          }
       }
       if recv.Type == "image_generation.completed" {
          if recv.Error == nil {
             fmt.Printf("recv.Usage: %v\\n", *recv.Usage)
          }
       }
    }
}
```



</Tab>
<Tab zoneid="QIT6P834Qk" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation .
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 

if __name__ == "__main__":
    stream = client.images.generate(
        model="seedream-5-0-260128",
        prompt="Referring to Figure 1, generate four images with characters wearing sunglasses, riding motorcycles, wearing hats, and holding lollipops",
        size="2K",
        output_format="png",
        response_format="b64_json",
        stream=True,
        extra_body={
            "image": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/seedream4_imageToimages_1.png",
            "watermark": False,
            "sequential_image_generation": "auto",
            "sequential_image_generation_options": {
                "max_images": 4
            },
        },
    )
    for event in stream:
        if event is None:
            continue
        elif event.type == "image_generation.partial_succeeded":
            if event.b64_json is not None:
                print(f"size={len(event.b64_json)}, base_64={event.b64_json}")
        elif event.type == "image_generation.completed":
            if event.usage is not None:
                print("Final completed event:")
                print("recv.Usage:", event.usage)
```



</Tab>
</Tabs>


<span id="6b32fe21"></span>
## Prompt optimization control

Set the **optimize_prompt_options.mode** parameter to choose between the `standard` mode and `fast` mode to optimize prompts for different requirements of picture quality and generation speed.


* To balance generation speed and image quality, seedream\-4\-0 allows you to set **optimize_prompt_options.mode** to `fast` to significantly increase generation speed, though this will come at the cost of some image quality.

* seedream\-5\-0\-lite and seedream\-4\-5 focus on high\-quality image generation and only support `standard` mode.



<Tabs>
<Tab zoneid="Nh9doXtYA0" title="Curl">
<TabTitle>Curl</TabTitle>

```Plain
curl https://ark.ap-southeast.bytepluses.com/api/v3/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "doubao-seedream-4-0-250828",
    "prompt": "Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.",
    "size": "2K",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 4
    },
    "optimize_prompt_options": {
        "mode": "fast"
    },
    "stream": false,
    "output_format":"png",
    "response_format": "url",
    "watermark": false
}'
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
<Tab zoneid="uX9rzuEsHP" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 
from byteplussdkarkruntime.types.images.images import SequentialImageGenerationOptions
from byteplussdkarkruntime.types.images.images import OptimizePromptOptions

client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    # Replace with Model ID
    model="doubao-seedream-4-0-250828", 
    prompt="Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.",
    size="2K",
    sequential_image_generation="auto",
    sequential_image_generation_options=SequentialImageGenerationOptions(max_images=4),
    optimize_prompt_options=OptimizePromptOptions(mode="fast"),
    output_format="png",
    response_format="url",
    watermark=False
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



</Tab>
<Tab zoneid="WVymurUQAU" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;


import com.byteplus.ark.runtime.model.images.generation.*;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays; 
import java.util.List; 
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample { 
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();
        
        GenerateImagesRequest.SequentialImageGenerationOptions sequentialImageGenerationOptions = new GenerateImagesRequest.SequentialImageGenerationOptions();
        sequentialImageGenerationOptions.setMaxImages(4);
        GenerateImagesRequest.OptimizePromptOptions optimizePromptOptions = new GenerateImagesRequest.OptimizePromptOptions();
        optimizePromptOptions.setMode("fast");
        
        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                 .model("doubao-seedream-4-0-250828")  //Replace with Model ID
                  .prompt("Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.")
                 .size("2K")
                 .sequentialImageGeneration("auto")
                 .sequentialImageGenerationOptions(sequentialImageGenerationOptions)
                 .optimizePromptOptions(optimizePromptOptions)
                 .outputFormat("png")
                 .responseFormat(ResponseFormat.Url)
                 .stream(false)
                 .watermark(false)
                 .build();
                 
        ImagesResponse imagesResponse = service.generateImages(generateRequest);
        // Iterate through all image data
        if (imagesResponse != null && imagesResponse.getData() != null) {
            for (int i = 0; i < imagesResponse.getData().size(); i++) {
                // Retrieve image information
                String url = imagesResponse.getData().get(i).getUrl();
                String size = imagesResponse.getData().get(i).getSize();
                System.out.printf("Image %d:%n", i + 1);
                System.out.printf("  URL: %s%n", url);
                System.out.printf("  Size: %s%n", size);
                System.out.println();
            }


            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="VsXeJKGQKj" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation .
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )    
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG
    var (
    sequentialImageGeneration model.SequentialImageGeneration = "auto"
    maxImages = 4
    mode model.OptimizePromptMode = model.OptimizePromptModeFast
    )
    
    generateReq := model.GenerateImagesRequest{
       Model:          "doubao-seedream-4-0-250828",
       Prompt:         "Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.",
       Size:           byteplus.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: byteplus.String("url"),
       Watermark:      byteplus.Bool(false),
       SequentialImageGeneration: &sequentialImageGeneration,
       SequentialImageGenerationOptions: &model.SequentialImageGenerationOptions{
          MaxImages: &maxImages,
       },
       OptimizePromptOptions: &model.OptimizePromptOptions{
       Mode: &mode,
       },
    }

    resp, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
        fmt.Printf("call GenerateImages error: %v\\n", err)
        return
    }

    if resp.Error != nil {
        fmt.Printf("API returned error: %s - %s\\n", resp.Error.Code, resp.Error.Message)
        return
    }

    // Output the generated image information
    fmt.Printf("Generated %d images:\\n", len(resp.Data))
    for i, image := range resp.Data {
        var url string
        if image.Url != nil {
            url = *image.Url
        } else {
            url = "N/A"
        }
        fmt.Printf("Image %d: Size: %s, URL: %s\\n", i+1, image.Size, url)
    }
}
```



</Tab>
<Tab zoneid="vGysAbbHYA" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI( 
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.getenv('ARK_API_KEY'), 
) 
 
imagesResponse = client.images.generate( 
    model="doubao-seedream-4-0-250828",
    prompt="Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {
            "max_images": 4
        },
        "optimize_prompt_options": {"mode": "fast"}
    },
) 
 
# Iterate through all image data
for image in imagesResponse.data:
    # Output the current image's URL and size
    print(f"URL: {image.url}, Size: {image.size}")
```



* You may replace the Model ID as needed. See [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310) for available models.


</Tab>
</Tabs>


<span id="3fa0345d"></span>
# Customize image output

You can configure the following parameters to control image output specifications:


* **size**: The dimensions of the output image.

* **response_format**: The format of the generated image.

* **output_format**: The format of the output image.

* **watermark**: Whether to add a watermark to the output image.

    &nbsp;


<span id="image-output-dimensions"></span>
## Image output dimensions

The following methods are available. The two methods cannot be used at the same time.


* Method 1 : Specify the resolution of the generated image, and describe its aspect ratio, shape, or purpose in the prompt using natural language. The model determines the width and height.

   * seedream\-5\-0\-lite: `2K`, `3K`, `4K`

   * seedream\-4\-5: `2K`, `4K`

   * seedream\-4\-0: `1K`, `2K`, `4K`

* Method 2: Specify the width and height of the generated image in pixels.

   * Default value: `2048x2048`

   * Total pixel range:

      * seedream\-5\-0\-lite: [`2560x1440=3686400`, `4096x4096=16777216`]

      * seedream\-4\-5: [`2560x1440=3686400`, `4096x4096=16777216`]

      * seedream\-4\-0: [`1280x720=921600`, `4096x4096=16777216`]

   * Aspect ratio range: [1/16, 16]



---




<columns>
<columnsItem zoneid="fBK2eHhfa7">

Method 1

</columnsItem>
<columnsItem zoneid="ECU2JcZuHZ">

Method 2

</columnsItem>
</columns>



<columns>
<columnsItem zoneid="G4rT7LJ2pO">

```JSON
{
    "prompt": "Generate a series of 4 posters focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.", // In the prompt, use natural language to describe the aspect ratio, shape, or purpose of the image
    "size": "2K"  // Specify the resolution of the generated image via the size parameter
}
```


</columnsItem>
<columnsItem zoneid="hJ9tLbFR0P">

```JSON
{
    "prompt": "Generate a series of 4 coherent illustrations focusing on the same corner of a courtyard across the four seasons, presented in a unified style that captures the unique colors, elements, and atmosphere of each season.", 
    "size": "2048x2048"  // Specify the width and height of the generated image in pixels
}
```


</columnsItem>
</columns>


Recommended dimensions:


<span aceTableMode="list" aceTableWidth="4,4,4,4,4"></span>
| |1K |2K |3K |4K |
|---|---|---|---|---|
|seedream\-5\-0\-lite |Not supported |`1:1`: 2048x2048<br><br>`3:4`: 1728x2304<br><br>`4:3`: 2304x1728<br><br>`16:9`: 2848x1600<br><br>`9:16`: 1600x2848<br><br>`3:2`: 2496x1664<br><br>`2:3`: 1664x2496<br><br>`21:9`: 3136x1344 |`1:1`: 3072x3072<br><br>`3:4`: 2592x3456<br><br>`4:3`: 3456x2592<br><br>`16:9`: 4096x2304<br><br>`9:16`: 2304x4096<br><br>`2:3`: 2496x3744<br><br>`3:2`: 3744x2496<br><br>`21:9`: 4704x2016 |`1:1`: 4096x4096<br><br>`3:4`: 3520x4704<br><br>`4:3`: 4704x3520<br><br>`16:9`: 5504x3040<br><br>`9:16`: 3040x5504<br><br>`2:3`: 3328x4992<br><br>`3:2`: 4992x3328<br><br>`21:9`: 6240x2656 |
|seedream\-4\-5 |Not supported |`1:1`: 2048x2048<br><br>`3:4`: 1728x2304<br><br>`4:3`: 2304x1728<br><br>`16:9`: 2848x1600<br><br>`9:16`: 1600x2848<br><br>`3:2`: 2496x1664<br><br>`2:3`: 1664x2496<br><br>`21:9`: 3136x1344 |Not supported |`1:1`: 4096x4096<br><br>`3:4`: 3520x4704<br><br>`4:3`: 4704x3520<br><br>`16:9`: 5504x3040<br><br>`9:16`: 3040x5504<br><br>`2:3`: 3328x4992<br><br>`3:2`: 4992x3328<br><br>`21:9`: 6240x2656 |
|seedream\-4\-0 |`1:1`: 1024x1024<br><br>`3:4`: 864x1152<br><br>`4:3`: 1152x864<br><br>`16:9`: 1312x736<br><br>`9:16`: 736x1312<br><br>`2:3`: 832x1248<br><br>`3:2`: 1248x832<br><br>`21:9`: 1568x672 |`1:1`: 2048x2048<br><br>`3:4`: 1728x2304<br><br>`4:3`: 2304x1728<br><br>`16:9`: 2848x1600<br><br>`9:16`: 1600x2848<br><br>`3:2`: 2496x1664<br><br>`2:3`: 1664x2496<br><br>`21:9`: 3136x1344 |Not supported |`1:1`: 4096x4096<br><br>`3:4`: 3520x4704<br><br>`4:3`: 4704x3520<br><br>`16:9`: 5504x3040<br><br>`9:16`: 3040x5504<br><br>`2:3`: 3328x4992<br><br>`3:2`: 4992x3328<br><br>`21:9`: 6240x2656 |


<span id="b4306703"></span>
## Image output methods

The generated image is in JPEG and can be returned in the following two ways:


* `url`: Return a download link of the image.

* `b64_json`: Return the image data in JSON as a Base64\-encoded string.


```JSON
{
    "response_format": "url"
}
```


<span id="dc49e523"></span>
## Image output format

The image format generated by seedream\-4\-5/4\-0 defaults to `jpeg` and does not support custom settings.

seedream\-5\-0\-lite allows specifying the format of generated image files by setting the **output_format** parameter.


* `png`

* `jpeg`


```JSON
{
    "output_format": "png"
}
```


<span id="6be7edc7"></span>
## Add a watermark to the image

Control whether to add a watermark to the generated image by setting the **watermark** parameter.


* `false`: No watermark.

* `true`: Add an "AI generated" watermark on the bottom\-right corner of the image.


```JSON
{
    "watermark": true
}
```


<span id="31037d05"></span>
# Usage limitations

**SDK version upgrade**

To ensure model functionalities, upgrade to the latest SDK version. Refer to [Install and upgrade SDK](https://docs.byteplus.com/en/docs/ModelArk/1541595) for details.

**Image input limitations**


* Image format: jpeg, png, webp, bmp, tiff, gif, heic, heif

* Aspect ratio (width/height): Between [1/16, 16]

* Width and height (px): Greater than 14 px

* Size: up to 30 MB

* Total pixels: No more than `6000x6000=36000000` px (The total pixel limit applies to the product of the single image’s width and height, rather than to either dimension individually.)

* Reference images: Up to 14 images can be uploaded.


**Retention period**

Image URL is retained for 24 hours and will be automatically cleared after expiration. Be sure to save your generated images in time.

**Rate limits information**


* RPM rate limit: The maximum number of pictures that can be generated per minute by a specific version of a model under an account. If the limit is exceeded, an error will occur.

* The limit values vary by model. For more details, see [Image generation](https://docs.byteplus.com/en/docs/ModelArk/1330310#d3e5e0eb).




