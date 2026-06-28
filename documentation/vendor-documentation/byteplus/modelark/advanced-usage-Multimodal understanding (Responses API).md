Vision models support input of images, videos, and documents to perform vision\-related tasks such as image captioning, visual question answering (VQA), and content moderation.

<span id="a1b6d1a2"></span>
## Supported models

For visual models of version 250615 and later, the Responses API is supported by default unless otherwise specified. For details, see [Visual understanding](https://docs.byteplus.com/en/docs/ModelArk/1330310#ff5ef604).

<span id="2c4704e7"></span>
## API reference

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<span id="08015281"></span>
## Related tutorials

The Responses API supports multiple file input methods: uploading files via the Files API, input as a Base64 string, and passing in a file URL.

This topic takes the **uploading via Files API** method as an example. For details about other file input methods, as well as image/video/document format requirements, file size limits, video frame extraction policies, etc., see the following tutorials:


* [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1362931)

* [Video understanding](https://docs.byteplus.com/model-invocation/multimodal-understanding/video-understanding-tt.md)

* [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1902647)


<span id="70e09284"></span>
## Image understanding

The model can understand information in images and complete vision\-related tasks such as describing objects in the images. For image input methods supported by image understanding and examples, see [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1362931).

It is recommended to prioritize using the Files API to upload local files, especially when image files are large, or images need to be reused across requests.

> This method supports files up to 512 MB. The storage period ranges from 1 to 30 days, with a default value of 7 days.


The image file and prompt used in the example are as follows:


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Input |Prompt |
|---|---|
|<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/16acff92a12f4518b1ae63b52d8b6d81~tplv-goo7wpa0wc-image.image) </span> |Based on the image, how many planets are listed in the table, and which row contains Earth? |


Code samples:


<Tabs>
<Tab zoneid="OMN9vlUpH2" title="cURL">
<TabTitle>cURL</TabTitle>

1. Upload the image file to get the File ID.

   ```Plain
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -F "purpose=user_data" \
     -F "file=@/Users/doc/demo.png"
   ```
   

2. Reference the File ID in the Responses API.

   ```JSON
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_image",
                       "file_id": "file-20251018****"
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
<Tab zoneid="QK8JVGAXee" title="Python">
<TabTitle>Python</TabTitle>

```Python
import asyncio
import os
from byteplussdkarkruntime import AsyncArk
from byteplussdkarkruntime.types.responses.response_completed_event import ResponseCompletedEvent
from byteplussdkarkruntime.types.responses.response_reasoning_summary_text_delta_event import ResponseReasoningSummaryTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_output_item_added_event import ResponseOutputItemAddedEvent
from byteplussdkarkruntime.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_text_done_event import ResponseTextDoneEvent

client = AsyncArk(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)

async def main():
    # upload pdf file
    print("Upload picture file")
    file = await client.files.create(
        # replace with your local picture path
        file=open("/Users/doc/ark_demo_img_1.png", "rb"),
        purpose="user_data"
    )
    print(f"File uploaded: {file.id}")

    # Wait for the file to finish processing
    await client.files.wait_for_processing(file.id)
    print(f"File processed: {file.id}")

    stream = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_image",
                    "file_id": file.id  # ref pdf file id
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?"
                }
            ]},
        ],
        caching={
            "type": "enabled",
        },
        store=True,
        stream=True
    )
    async for event in stream:
        if isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
            print(event.delta, end="")
        if isinstance(event, ResponseOutputItemAddedEvent):
            print("\noutPutItem " + event.type + " start:")
        if isinstance(event, ResponseTextDeltaEvent):
            print(event.delta,end="")
        if isinstance(event, ResponseTextDoneEvent):
            print("\noutPutTextDone.")
        if isinstance(event, ResponseCompletedEvent):
            print("Response Completed. Usage = " + event.response.usage.model_dump_json())

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="oSiNV1qn8b" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload image data -----")
    data, err := os.Open("/Users/doc/ark_demo_img_1.png")
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for image to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("Image processing completed: %s, status: %s\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Image{
                    Image: &responses.ContentItemImage{
                        Type:   responses.ContentItemType_input_image,
                        FileId: byteplus.String(fileInfo.ID),
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
    createResponsesReq := &responses.ResponsesRequest{
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
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
    }

    resp, err := client.CreateResponsesStream(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\n", err)
        return
    }
    var responseId string
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v\n", err)
            return
        }
        handleEvent(event)
        if responseEvent := event.GetResponse(); responseEvent != nil {
            responseId = responseEvent.GetResponse().GetId()
            fmt.Printf("Response ID: %s", responseId)
        }
    }
}

func handleEvent(event *responses.Event) {
    switch event.GetEventType() {
    case responses.EventType_response_reasoning_summary_text_delta.String():
        print(event.GetReasoningText().GetDelta())
    case responses.EventType_response_reasoning_summary_text_done.String(): // aggregated reasoning text
        fmt.Printf("\nAggregated reasoning text: %s\n", event.GetReasoningText().GetText())
    case responses.EventType_response_output_text_delta.String():
        print(event.GetText().GetDelta())
    case responses.EventType_response_output_text_done.String(): // aggregated output text
        fmt.Printf("\nAggregated output text: %s\n", event.GetTextDone().GetText())
    default:
        return
    }
}
```



</Tab>
<Tab zoneid="hT4sUBLOsM" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.PreprocessConfigs;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.files.Video;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemImage;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;

import com.byteplus.ark.runtime.model.responses.event.functioncall.FunctionCallArgumentsDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemAddedEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.reasoningsummary.ReasoningSummaryTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.response.ResponseCompletedEvent;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload an image for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/ark_demo_img_1.png")) // replace with your image file path
                        .purpose("user_data")
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for image to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
            System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemImage.builder().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Based on the image, how many planets are listed in the table, and which row contains Earth?").build())
                                        .build()
                        ).build()
                ).build())
                .build();

        service.streamResponse(request)
                .doOnError(Throwable::printStackTrace)
                .blockingForEach(event -> {
                    if (event instanceof ReasoningSummaryTextDeltaEvent) {
                        System.out.print(((ReasoningSummaryTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputItemAddedEvent) {
                        System.out.println("\nOutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                    }
                    if (event instanceof OutputTextDeltaEvent) {
                        System.out.print(((OutputTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputTextDoneEvent) {
                        System.out.println("\nOutputText End.");
                    }
                    if (event instanceof OutputItemDoneEvent) {
                        System.out.println("\nOutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                    }
                    if (event instanceof FunctionCallArgumentsDoneEvent) {
                        System.out.println("\nFunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                    }
                    if (event instanceof ResponseCompletedEvent) {
                        System.out.println("\nResponse Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                    }
                });


        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="krt7Uc9ZHB" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
import time
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

file = client.files.create(
    file=open("/Users/doc/ark_demo_img_1.png", "rb"),
    purpose="user_data"
)
# Wait for the file to finish processing
while (file.status == "processing"):
    time.sleep(2)
    file = client.files.retrieve(file.id)
print(f"File processed: {file}")
    
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                    "text": "Based on the image, how many planets are listed in the table, and which row contains Earth?",
                },
            ]
        }
    ],
    stream=True
)

for event in response:
    if event.type == "response.reasoning_summary_text.delta":
        print(event.delta, end="")
    if event.type == "response.output_item.added":
        print("\noutPutItem " + event.type + " start:")
    if event.type == "response.output_text.delta":
        print(event.delta,end="")
    if event.type == "response.output_item.done":
        print("\noutPutTextDone.")
    if event.type == "response.completed":
        print("\nResponse Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
</Tabs>


Output example:

```Markdown
Reasoning: Got it, let's answer this step by step. First count the planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune. That's 8 planets total, which matches the description saying 8 planets. Then Earth is the 3rd row, after Mercury (1st) and Venus (2nd), right? Let's confirm: first row after headers is Mercury (row 1 of data), Venus (row 2), Earth is the 3rd data row (the 4th row overall in the table, including the header row)...

Answer: First, there are 8 planets listed in the table, matching the description that the table covers all eight solar system planets. Earth is the third data row of the table (the fourth full table row, if you count the column header row as the first row), it sits between the Venus row and the Mars row, with its volume (Earth=1) marked as 1.00, and its distance from the Sun as 149.6 million km.
```


<span id="098ef3d4"></span>
## Video understanding

The model can understand the visual information in the video, and complete vision\-related tasks such as describing the objects in it and analyzing action logic. For file input methods supported by video understanding and examples, see [Video understanding](https://docs.byteplus.com/model-invocation/multimodal-understanding/video-understanding-tt.md).

It is recommended to prioritize using the Files API to upload local video files, especially when video files are large, or videos need to be reused across requests.

> This method supports files up to 512 MB. The storage period ranges from 1 to 30 days, with a default value of 7 days.


The video file and prompt used in the example are as follows:


<span aceTableMode="list" aceTableWidth="1,1"></span>
|Video file |Prompt |
|---|---|
|<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/608b664aad1b49ce9fd41b597551236b" controls></video><br> |Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp. |


Code samples:


<Tabs>
<Tab zoneid="Pm64H67wDj" title="cURL">
<TabTitle>cURL</TabTitle>

1. Upload the video file to obtain the File ID.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \\
     -H "Authorization: Bearer $ARK_API_KEY" \\
     -F "purpose=user_data" \\
     -F "file=@/Users/doc/demo.mp4" \\
     -F "preprocess_configs[video][fps]=0.3"
   ```
   

2. Reference the File ID in the Responses API.

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
                       "type": "input_video",
                       "file_id": "file-20251018****"
                   },
                   {
                       "type": "input_text",
                       "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp."
                   }
               ]
           }
       ]
     }'
   ```
   


</Tab>
<Tab zoneid="IKn3i5ro45" title="Python">
<TabTitle>Python</TabTitle>

```Python
import asyncio
import os
from byteplussdkarkruntime import AsyncArk
from byteplussdkarkruntime.types.responses.response_completed_event import ResponseCompletedEvent
from byteplussdkarkruntime.types.responses.response_reasoning_summary_text_delta_event import ResponseReasoningSummaryTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_output_item_added_event import ResponseOutputItemAddedEvent
from byteplussdkarkruntime.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_text_done_event import ResponseTextDoneEvent

client = AsyncArk(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)

async def main():
    # upload video file
    print("Upload video file")
    file = await client.files.create(
        # replace with your local video path
        file=open("/Users/doc/demo.mp4", "rb"),
        purpose="user_data",
        preprocess_configs={
            "video": {
                "fps": 0.3,  # define the sampling fps of the video, default is 1.0
            }
        }
    )
    print(f"File uploaded: {file.id}")

    # Wait for the file to finish processing
    await client.files.wait_for_processing(file.id)
    print(f"File processed: {file.id}")

    stream = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_video",
                    "file_id": file.id  # ref video file id
                },
                {
                    "type": "input_text",
                    "text": "Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp."
                    
                }
            ]},
        ],
        caching={
            "type": "enabled",
        },
        store=True,
        stream=True
    )
    
    async for event in stream:
        if isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
            print(event.delta, end="")
        if isinstance(event, ResponseOutputItemAddedEvent):
            print("\noutPutItem " + event.type + " start:")
        if isinstance(event, ResponseTextDeltaEvent):
            print(event.delta,end="")
        if isinstance(event, ResponseTextDoneEvent):
            print("\noutPutTextDone.")
        if isinstance(event, ResponseCompletedEvent):
            print("Response Completed. Usage = " + event.response.usage.model_dump_json())

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="IMCB8E9xQ6" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
        os.Getenv("ARK_API_KEY"),
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    fmt.Println("----- upload video data -----")
    data, err := os.Open("/Users/doc/demo.mp4")
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
        PreprocessConfigs: &file.PreprocessConfigs{
            Video: &file.Video{
                Fps: byteplus.Float64(0.3),
            },
        },
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for video to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("Video processing completed: %s, status: %s\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_Video{
                    Video: &responses.ContentItemVideo{
                        Type:   responses.ContentItemType_input_video,
                        FileId: byteplus.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Please describe the series of actions performed by the person in the video. Output the start time (start_time), end time (end_time), event (event), and whether it is dangerous (danger) in JSON format. Use HH:mm:ss to represent the timestamp.",
                    },
                },
            },
        },
    }
    createResponsesReq := &responses.ResponsesRequest{
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
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
    }

    resp, err := client.CreateResponsesStream(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\n", err)
        return
    }
    var responseId string
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v\n", err)
            return
        }
        handleEvent(event)
        if responseEvent := event.GetResponse(); responseEvent != nil {
            responseId = responseEvent.GetResponse().GetId()
            fmt.Printf("Response ID: %s", responseId)
        }
    }
}

func handleEvent(event *responses.Event) {
    switch event.GetEventType() {
    case responses.EventType_response_reasoning_summary_text_delta.String():
        print(event.GetReasoningText().GetDelta())
    case responses.EventType_response_reasoning_summary_text_done.String(): // aggregated reasoning text
        fmt.Printf("\nAggregated reasoning text: %s\n", event.GetReasoningText().GetText())
    case responses.EventType_response_output_text_delta.String():
        print(event.GetText().GetDelta())
    case responses.EventType_response_output_text_done.String(): // aggregated output text
        fmt.Printf("\nAggregated output text: %s\n", event.GetTextDone().GetText())
    default:
        return
    }
}
```



</Tab>
<Tab zoneid="vFBSXxV8B0" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.PreprocessConfigs;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.files.Video;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemVideo;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;

import com.byteplus.ark.runtime.model.responses.event.functioncall.FunctionCallArgumentsDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemAddedEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.reasoningsummary.ReasoningSummaryTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.response.ResponseCompletedEvent;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {
    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload a video for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.mp4")) // replace with your video file path
                        .purpose("user_data")
                        .preprocessConfigs(PreprocessConfigs.builder().video(new Video(0.3)).build())
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for video to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
            System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemVideo.builder().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Please describe the movement sequence of the characters in the video, and output the start time (start_time), end time (end_time), event (event), and danger status (danger) in JSON format. Please use HH:mm:ss to represent the timestamp.").build())
                                        .build()
                        ).build()
                ).build())
                .build();

        service.streamResponse(request)
                .doOnError(Throwable::printStackTrace)
                .blockingForEach(event -> {
                    if (event instanceof ReasoningSummaryTextDeltaEvent) {
                        System.out.print(((ReasoningSummaryTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputItemAddedEvent) {
                        System.out.println("\nOutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                    }
                    if (event instanceof OutputTextDeltaEvent) {
                        System.out.print(((OutputTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputTextDoneEvent) {
                        System.out.println("\nOutputText End.");
                    }
                    if (event instanceof OutputItemDoneEvent) {
                        System.out.println("\nOutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                    }
                    if (event instanceof FunctionCallArgumentsDoneEvent) {
                        System.out.println("\nFunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                    }
                    if (event instanceof ResponseCompletedEvent) {
                        System.out.println("\nResponse Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                    }
                });


        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="GVDsXtg4Qr" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
import time
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

file = client.files.create(
    file=open("/Users/doc/demo.mp4", "rb"),
    purpose="user_data"
)
# Wait for the file to finish processing
while (file.status == "processing"):
    time.sleep(2)
    file = client.files.retrieve(file.id)
print(f"File processed: {file}")
    
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_video",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                    "text": "Please describe the series of actions performed by the person in the video. Output the start time (start_time), end time (end_time), event (event), and whether it is dangerous (danger) in JSON format. Use HH:mm:ss to represent the timestamp.",
                },
            ]
        }
    ],
    stream=True
)


for event in response:
    if event.type == "response.reasoning_summary_text.delta":
        print(event.delta, end="")
    if event.type == "response.output_item.added":
        print("\noutPutItem " + event.type + " start:")
    if event.type == "response.output_text.delta":
        print(event.delta,end="")
    if event.type == "response.output_item.done":
        print("\noutPutTextDone.")
    if event.type == "response.completed":
        print("\nResponse Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
</Tabs>


Output example:

```JSON
{
    "text": [
        {
            "start_time": "00:00:00",
            "end_time": "00:00:03",
            "event": "Stack the yellow block on top of the red-yellow-green block tower.",
            "danger": false
        },
        {
            "start_time": "00:00:05",
            "end_time": "00:00:07",
            "event": "Pick up the blue block, put it in the mouth to bite, then take it out",
            "danger": false
        },
        {
            "start_time": "00:00:08",
            "end_time": "00:00:12",
            "event": "Push the yellow and blue toy trucks across the floor by hand.",
            "danger": false
        },
        {
            "start_time": "00:00:12",
            "end_time": "00:00:24",
            "event": "Hold the edge of the wooden drawer cabinet with both hands and try to step on the lower drawer handle with the right foot to climb up.",
            "danger": true
        }
    ]
}
```


<span id="18a762a5"></span>
## Document understanding

The model supports processing PDF documents. During preprocessing, it splits the document into pages and converts them into multiple images, then inputs each image into the model for processing to realize understanding and analysis of the document content. For file input methods supported by document understanding and examples, see [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1902647).

It is recommended to prioritize using the Files API, especially when files are large, or files need to be reused across requests.

> This method supports files up to 512 MB. The storage period ranges from 1 to 30 days, with a default value of 7 days.


The PDF file and prompt used in the example are as follows:


<span aceTableMode="list" aceTableWidth="1,1"></span>
|PDF file |Prompt |
|---|---|
|<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0335ac1d4cdc4378bd291584131c2cce~tplv-goo7wpa0wc-image.image) </span> |Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information. |


Code samples:


<Tabs>
<Tab zoneid="BNP9kosu8L" title="cURL">
<TabTitle>cURL</TabTitle>

1. Upload the PDF file to obtain the File ID.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/files \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -F "purpose=user_data" \
     -F "file=@/Users/doc/demo.pdf"
   ```
   

2. Reference the File ID in the Responses API.

   ```Bash
   curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \
     -H "Authorization: Bearer $ARK_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{
       "model": "seed-2-0-lite-260228",
       "input": [
           {
               "role": "user",
               "content": [
                   {
                       "type": "input_file",
                       "file_id": "file-20251018****"
                   },
                   {
                       "type": "input_text",
                       "text": "Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information."
                   }
               ]
           }
       ]
     }'
   ```
   


</Tab>
<Tab zoneid="R1ywmz5nEb" title="Python">
<TabTitle>Python</TabTitle>

```Python
import asyncio
import os
from byteplussdkarkruntime import AsyncArk
from byteplussdkarkruntime.types.responses.response_completed_event import ResponseCompletedEvent
from byteplussdkarkruntime.types.responses.response_reasoning_summary_text_delta_event import ResponseReasoningSummaryTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_output_item_added_event import ResponseOutputItemAddedEvent
from byteplussdkarkruntime.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from byteplussdkarkruntime.types.responses.response_text_done_event import ResponseTextDoneEvent

client = AsyncArk(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY')
)

async def main():
    # upload pdf file
    print("Upload pdf file")
    file = await client.files.create(
        # replace with your local pdf path
        file=open("/Users/doc/demo.pdf", "rb"),
        purpose="user_data"
    )
    print(f"File uploaded: {file.id}")

    # Wait for the file to finish processing
    await client.files.wait_for_processing(file.id)
    print(f"File processed: {file.id}")

    stream = await client.responses.create(
        model="seed-2-0-lite-260228",
        input=[
            {"role": "user", "content": [
                {
                    "type": "input_file",
                    "file_id": file.id  # ref pdf file id
                },
                {
                    "type": "input_text",
                    "text": "Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information."
                }
            ]},
        ],
        caching={
            "type": "enabled",
        },
        store=True,
        stream=True
    )
    async for event in stream:
        if isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
            print(event.delta, end="")
        if isinstance(event, ResponseOutputItemAddedEvent):
            print("\noutPutItem " + event.type + " start:")
        if isinstance(event, ResponseTextDeltaEvent):
            print(event.delta,end="")
        if isinstance(event, ResponseTextDoneEvent):
            print("\noutPutTextDone.")
        if isinstance(event, ResponseCompletedEvent):
            print("Response Completed. Usage = " + event.response.usage.model_dump_json())

if __name__ == "__main__":
    asyncio.run(main())
```



</Tab>
<Tab zoneid="Gyfy2tmraK" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "io"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/file"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model/responses"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    client := arkruntime.NewClientWithApiKey(os.Getenv("ARK_API_KEY"))
    ctx := context.Background()

    fmt.Println("----- upload file data -----")
    data, err := os.Open("/Users/doc/demo.pdf")
    if err != nil {
        fmt.Printf("read file error: %v\n", err)
        return
    }
    fileInfo, err := client.UploadFile(ctx, &file.UploadFileRequest{
        File:    data,
        Purpose: file.PurposeUserData,
    })

    if err != nil {
        fmt.Printf("upload file error: %v", err)
        return
    }

    // Wait for the file to finish processing
    for fileInfo.Status == file.StatusProcessing {
        fmt.Println("Waiting for file to be processed...")
        time.Sleep(2 * time.Second)
        fileInfo, err = client.RetrieveFile(ctx, fileInfo.ID) // update file info
        if err != nil {
            fmt.Printf("get file status error: %v", err)
            return
        }
    }
    fmt.Printf("File processing completed: %s, status: %s\n", fileInfo.ID, fileInfo.Status)
    inputMessage := &responses.ItemInputMessage{
        Role: responses.MessageRole_user,
        Content: []*responses.ContentItem{
            {
                Union: &responses.ContentItem_File{
                    File: &responses.ContentItemFile{
                        Type:   responses.ContentItemType_input_file,
                        FileId: byteplus.String(fileInfo.ID),
                    },
                },
            },
            {
                Union: &responses.ContentItem_Text{
                    Text: &responses.ContentItemText{
                        Type: responses.ContentItemType_input_text,
                        Text: "Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information.",
                    },
                },
            },
        },
    }
    createResponsesReq := &responses.ResponsesRequest{
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
        Caching: &responses.ResponsesCaching{Type: responses.CacheType_enabled.Enum()},
    }

    resp, err := client.CreateResponsesStream(ctx, createResponsesReq)
    if err != nil {
        fmt.Printf("stream error: %v\n", err)
        return
    }
    var responseId string
    for {
        event, err := resp.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Printf("stream error: %v\n", err)
            return
        }
        handleEvent(event)
        if responseEvent := event.GetResponse(); responseEvent != nil {
            responseId = responseEvent.GetResponse().GetId()
            fmt.Printf("Response ID: %s", responseId)
        }
    }
}

func handleEvent(event *responses.Event) {
    switch event.GetEventType() {
    case responses.EventType_response_reasoning_summary_text_delta.String():
        print(event.GetReasoningText().GetDelta())
    case responses.EventType_response_reasoning_summary_text_done.String(): // aggregated reasoning text
        fmt.Printf("\nAggregated reasoning text: %s\n", event.GetReasoningText().GetText())
    case responses.EventType_response_output_text_delta.String():
        print(event.GetText().GetDelta())
    case responses.EventType_response_output_text_done.String(): // aggregated output text
        fmt.Printf("\nAggregated output text: %s\n", event.GetTextDone().GetText())
    default:
        return
    }
}
```



</Tab>
<Tab zoneid="C58HezgLJt" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.example;

import com.byteplus.ark.runtime.model.files.FileMeta;
import com.byteplus.ark.runtime.model.files.UploadFileRequest;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemFile;
import com.byteplus.ark.runtime.service.ArkService;
import com.byteplus.ark.runtime.model.responses.request.*;
import com.byteplus.ark.runtime.model.responses.item.ItemEasyMessage;
import com.byteplus.ark.runtime.model.responses.constant.ResponsesConstants;
import com.byteplus.ark.runtime.model.responses.item.MessageContent;
import com.byteplus.ark.runtime.model.responses.content.InputContentItemText;

import com.byteplus.ark.runtime.model.responses.event.functioncall.FunctionCallArgumentsDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemAddedEvent;
import com.byteplus.ark.runtime.model.responses.event.outputitem.OutputItemDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.outputtext.OutputTextDoneEvent;
import com.byteplus.ark.runtime.model.responses.event.reasoningsummary.ReasoningSummaryTextDeltaEvent;
import com.byteplus.ark.runtime.model.responses.event.response.ResponseCompletedEvent;
import java.io.File;
import java.util.concurrent.TimeUnit;

public class demo {

    public static void main(String[] args) {
        String apiKey = System.getenv("ARK_API_KEY");
        ArkService service = ArkService.builder().apiKey(apiKey).baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3").build();

        System.out.println("===== Upload File Example=====");
        // upload a file for responses
        FileMeta fileMeta;
        fileMeta = service.uploadFile(
                UploadFileRequest.builder().
                        file(new File("/Users/doc/demo.pdf")) // replace with your file path
                        .purpose("user_data")
                        .build());
        System.out.println("Uploaded file Meta: " + fileMeta);
        System.out.println("status:" + fileMeta.getStatus());

        try {
            while (fileMeta.getStatus().equals("processing")) {
                System.out.println("Waiting for file to be processed...");
                TimeUnit.SECONDS.sleep(2);
                fileMeta = service.retrieveFile(fileMeta.getId());
            }
        } catch (Exception e) {
            System.err.println("get file status error: " + e.getMessage());
        }
        System.out.println("Uploaded file Meta: " + fileMeta);

        CreateResponsesRequest request = CreateResponsesRequest.builder()
                .model("seed-2-0-lite-260228")
                .stream(true)
                .input(ResponsesInput.builder().addListItem(
                        ItemEasyMessage.builder().role(ResponsesConstants.MESSAGE_ROLE_USER).content(
                                MessageContent.builder()
                                        .addListItem(InputContentItemFile.InputContentItemFileBuilder.anInputContentItemFile().fileId(fileMeta.getId()).build())
                                        .addListItem(InputContentItemText.builder().text("Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information.").build())
                                        .build()
                        ).build()
                ).build())
                .build();

        service.streamResponse(request)
                .doOnError(Throwable::printStackTrace)
                .blockingForEach(event -> {
                    if (event instanceof ReasoningSummaryTextDeltaEvent) {
                        System.out.print(((ReasoningSummaryTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputItemAddedEvent) {
                        System.out.println("\nOutputItem " + (((OutputItemAddedEvent) event).getItem().getType()) + " Start: ");
                    }
                    if (event instanceof OutputTextDeltaEvent) {
                        System.out.print(((OutputTextDeltaEvent) event).getDelta());
                    }
                    if (event instanceof OutputTextDoneEvent) {
                        System.out.println("\nOutputText End.");
                    }
                    if (event instanceof OutputItemDoneEvent) {
                        System.out.println("\nOutputItem " + ((OutputItemDoneEvent) event).getItem().getType() + " End.");
                    }
                    if (event instanceof FunctionCallArgumentsDoneEvent) {
                        System.out.println("\nFunctionCall Arguments: " + ((FunctionCallArgumentsDoneEvent) event).getArguments());
                    }
                    if (event instanceof ResponseCompletedEvent) {
                        System.out.println("\nResponse Completed. Usage = " + ((ResponseCompletedEvent) event).getResponse().getUsage());
                    }
                });


        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="sks6dtWvKP" title="OpenAI SDK">
<TabTitle>OpenAI SDK</TabTitle>

```Python
import os
import time
from openai import OpenAI

api_key = os.getenv('ARK_API_KEY')

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
)

file = client.files.create(
    file=open("/Users/doc/demo.pdf", "rb"),
    purpose="user_data"
)
# Wait for the file to finish processing
while (file.status == "processing"):
    time.sleep(2)
    file = client.files.retrieve(file.id)
print(f"File processed: {file}")
    
response = client.responses.create(
    model="seed-2-0-lite-260228",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_file",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                    "text": "Provide the text content in the document by paragraph in JSON format, including paragraph type (type) and text content (content) information.",
                },
            ]
        }
    ],
    stream=True
)

for event in response:
    if event.type == "response.reasoning_summary_text.delta":
        print(event.delta, end="")
    if event.type == "response.output_item.added":
        print("\noutPutItem " + event.type + " start:")
    if event.type == "response.output_text.delta":
        print(event.delta,end="")
    if event.type == "response.output_item.done":
        print("\noutPutTextDone.")
    if event.type == "response.completed":
        print("\nResponse Completed. Usage = " + event.response.usage.model_dump_json())
```



</Tab>
</Tabs>


Example output:

```JSON
{
    "text": [
        {
            "type": "heading",
            "content": "1 Introduction"
        },
        {
            "type": "paragraph",
            "content": "Diffusion models [3–5] learn to reverse a process that incrementally corrupts data with noise, effectively decomposing a complex distribution into a hierarchy of simplified representations. This coarse-to-fine generative approach has proven remarkably successful across a wide range of applications, including image and video synthesis [6] as well as solving complex challenges in natural sciences [7]."
        },
        ...
        {
            "type": "heading",
            "content": "3 Seed Diffusion"
        },
        {
            "type": "paragraph",
            "content": "As the first experimental model in our Seed Diffusion series, Seed Diffusion Preview is specifically focused on code generation, thus adopting the data pipeline (code/code-related data only) and processing methodology of the open-sourced Seed Coder project [20]. The architecture is a standard dense Transformer, and we intentionally omit complex components such as LongCoT reasoning in this initial version to first establish a strong and efficient performance baseline. This section introduces its key components and training strategies."
        }
    ]
}
```




