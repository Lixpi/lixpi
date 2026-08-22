<div data-tips="true" data-tips-type="danger" data-tips-is-title="true">Warning</div>



* <div data-tips="true" data-tips-type="danger">The upload asset (CreateAsset) API is asynchronous. System processing may result in queuing, which can increase the time required for storage; higher latency is expected for uploading video.</div>


* <div data-tips="true" data-tips-type="danger">SLA for uploading time is not guaranteed.</div>


* <div data-tips="true" data-tips-type="danger">You must ensure that the uploaded virtual portrait meets the following conditions:</div>


   * <div data-tips="true" data-tips-type="danger">You legally own the asset and have full rights to use and dispose of it. The asset does not contain unauthorized third\-party trademarks or logo content.</div>


   * <div data-tips="true" data-tips-type="danger">The asset must not resemble any real human person's portrait, must not be plagiarized or misappropriated, and must not infringe upon any third party's personality rights, intellectual property rights, or other legal interests.</div>


   * <div data-tips="true" data-tips-type="danger">The asset does not contain content that violates regulations, contravenes public order and morals, or endangers national security.</div>



The Dreamina Seedance 2.0 (Seedance 2.0) and Dreamina Seedance 2.5 (Seedance 2.5) models have comprehensive capabilities to prevent Deepfake and copyright infringement risks. When generating video, risky reference material input will be intercepted to maximize compliance and security of the generated video.

To ensure creators can fully leverage the powerful video generation capabilities of Seedance 2.0 and Seedance 2.5 to efficiently generate video content while avoiding potential risks of AI\-generated content, ModelArk has launched the private trusted asset library. Trusted assets that have been added to the library will enter your private asset library and be used in video generation.

The workflow for using the private asset library is as follows:

<span>![图片](https://arkdoc.tos-cn-beijing.volces.com/images/video-generation/bp_advanced_creative_packs.png) </span>

<span id="67fe3c93"></span>
# Prerequisites

To access the full features of the Asset Library, you need to activate the Advanced Creation Rights. The capacity quota is shared between Private Virtual Avatar Asset Library and Real\-human Portrait Library. For details, please refer to [Dreamina Seedance Advanced Creation Rights Purchase Guide](https://docs.byteplus.com/en/docs/ModelArk/2377608).

<span id="7597a0cd"></span>
# Structure of the asset library


* **Asset Group** : Each asset file is an Asset, and each Asset belongs to an Asset Group.

   * Asset groups allow flexible management of assets. For example, assets of the same person can be grouped together.

* **Asset** : A file (image, video or audio) that is trusted by the Seedance 2.0 and Seedance 2.5 models for inference.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">Only assets required for inference need to be added to the library; do not add assets that are not required.</div>


* <div data-tips="true" data-tips-type="tip">Only the Asset ID of assets already added to the library can be used for video generation; assets for the same character that are not added to the library cannot be used.</div>


* <div data-tips="true" data-tips-type="tip">Each uploaded asset must be preprocessed. You can poll the GetAsset API to check the asset status (the <code>Status</code> field). The asset can be used for subsequent inference only after the status becomes <code>Active</code>. If the status is <code>Failed</code>, preprocessing has failed and the asset cannot be used for inference. For details, see the code sample in <a href="https://docs.byteplus.com/en/docs/ModelArk/2333565#28a8c5b5">Example: Upload assets and use GetAsset to retrieve asset information </a>.</div>



Taking uploading character image asset as an example:

**Single image file format requirements** :


* Format: jpeg, png, webp, bmp, tiff, gif, heic/heif

* Aspect ratio (width/height): (0.4, 2.5)

* Width and height (px): (300, 6000)

* Each image file must be less than 30 MB.


To ensure that the character's face, clothing details, and other features in the generated video are consistent with the uploaded asset, it is recommended to upload multiple assets of the same person into the same asset group according to the following rules and examples:

**Best practices for portrait asset content** :

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip"><strong>Full\-body reference image requirements</strong></div>



* <div data-tips="true" data-tips-type="tip">Layout: Vertical</div>


* <div data-tips="true" data-tips-type="tip">Image content: Full\-body frontal image of the person</div>



<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/86fef6988c8449c2a3d9062b2fa50e96~tplv-goo7wpa0wc-image.image" width="333px" /></div>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip"><strong>Facial close\-up image requirements</strong></div>



* <div data-tips="true" data-tips-type="tip">Layout: Vertical</div>


* <div data-tips="true" data-tips-type="tip">Image content: Frontal close\-up of the person without expression, above the shoulders, with the face occupying about two\-thirds of the frame</div>



<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6188f2b280eb43a3821644071a2c5485~tplv-goo7wpa0wc-image.image" width="272px" /></div>


<span id="577c8ba0"></span>
# Assets API list

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">To call the Assets API interface, you must use Access Key authentication. For details, refer to <a href="https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey">Obtain API access keys (AK/SK)</a>.</div>


<span id="6b7beaf5"></span>
## **Asset (group) creation**


1. [CreateAssetGroup](https://docs.byteplus.com/en/docs/ModelArk/2318270): create an asset group. **When creating an asset group for the first time, you must sign an authorization letter in the console.**

2. [CreateAsset](https://docs.byteplus.com/en/docs/ModelArk/2318271): create an asset. This interface can be used to upload personal assets. After creating an asset, you can use the asset **Id (must be in active status)**  returned in the response fields for generating videos with the Seedance 2.0 and Seedance 2.5 models.


<span id="b8447895"></span>
## **Asset (group) management**


* [ListAssetGroups](https://docs.byteplus.com/en/docs/ModelArk/2318272): query the list of asset groups.

* [ListAssets](https://docs.byteplus.com/en/docs/ModelArk/2318273): query the list of assets.

* [GetAsset](https://docs.byteplus.com/en/docs/ModelArk/2318274): query asset information.

* [GetAssetGroup](https://docs.byteplus.com/en/docs/ModelArk/2318275): query asset group information.

* [UpdateAssetGroup](https://docs.byteplus.com/en/docs/ModelArk/2318276): update asset group information.

* [UpdateAsset](https://docs.byteplus.com/en/docs/ModelArk/2318277): update asset information.

* [DeleteAsset](https://docs.byteplus.com/en/docs/ModelArk/2318278): delete an asset.

* [DeleteAssetGroup](https://docs.byteplus.com/en/docs/ModelArk/2341606): delete an asset group.


<span id="0ca26709"></span>
## Rate limits

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>QPS</strong> : Maximum total request count <strong>per second</strong> ; request will return an error when this limit is exceeded.</div>


* <div data-tips="true" data-tips-type="tip"><strong>QPM</strong> : Maximum total request count <strong>per minute</strong> ; requests will return an error when this limit is exceeded.</div>




|API |Rate limits by account |
|---|---|
|CreateAssetGroup |10 QPS |
|CreateAsset |API rate limits vary by rights type. For detailed limits, see [Dreamina Seedance Advanced Creation Rights purchase guide](https://docs.byteplus.com/en/docs/ModelArk/2377608). |
|ListAssetGroups |10 QPS |
|ListAssets |10 QPS |
|GetAsset |100 QPS |
|GetAssetGroup |10 QPS |
|UpdateAsset |10 QPS |
|UpdateAssetGroup |10 QPS |
|DeleteAsset |10 QPS |
|DeleteAssetGroup |5 QPS |


<span id="88f1bdfd"></span>
# Tutorial

<span id="f5952860"></span>
## Upload assets to the virtual portrait library (API & UI console)

You can upload your own virtual portraits to the private asset library.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">You must ensure that the uploaded virtual portrait meets the following conditions:</div>



* <div data-tips="true" data-tips-type="tip">You legally own the asset and have full rights to use and dispose of it. The asset does not contain any unauthorized third\-party trademarks or logo content.</div>


* <div data-tips="true" data-tips-type="tip">The asset must not resemble the portrait or likeness of any natural person, must not involve plagiarism or misappropriation, and must not infringe upon any third party's personality rights, intellectual property rights, or other legal rights and interests.</div>


* <div data-tips="true" data-tips-type="tip">The asset does not contain content that violates laws and regulations, public order and good morals, or endangers national security.</div>



ModelArk will conduct a security review of the assets you upload. Once approved, you can use the assets to generate video in the Experience Center and API.

You can use OpenAPI interfaces or upload assets in the Model Playground.

<span id="438e9280"></span>
### Use the console


1. Open [Model Playground](https://ai.byteplus.com/ark/region:ap-southeast-1/experience/vision?modelId=dreamina-seedance-2-0-260128&tab=GenVideo) \> **My assets** \> **Virtual Portrait** \> **Manage assets** .


<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3ec415133c6c4f938b5f11d04459cfb4~tplv-goo7wpa0wc-image.image) </span>


2. Create an asset group.

3. Upload assets to the asset group.


<span id="927537a1"></span>
### Use the API


* CreateAssetGroup: Create an asset group

* CreateAsset: Upload assets to the group


Request example:


1. **Create an asset group**


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">Calling the Assets API requires Access Key authentication. For details, refer to <a href="https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey">API access key management</a>.</div>


* <div data-tips="true" data-tips-type="tip">For API parameter information, please refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2333601">Virtual portrait library API reference</a>.</div>



Use the **POST** CreateAssetGroup API to create an asset group.

Include the following fields in the request body:


* **Name** : The name of the asset group.

* **Description** : The description of the asset group.

* **GroupType** : Optional. Defaults to AIGC (virtual portrait asset).


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Currently, only AIGC is supported.</div>



* **ProjectName** : Optional. Specifies the resource project name. Defaults to default. Resources in a project can only be used by inference endpoints within that project. For more information about project, see the related [IAM docs](https://docs.byteplus.com/en/docs/byteplus-platform/docs-managing-projects).


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If <strong>ProjectName</strong> is not specified in the request, the asset group will be created in the <strong>default</strong> project by default.</div>


Request example:

**Note** : AK/SK authentication is required. For details, see [API access key management](https://docs.byteplus.com/en/docs/byteplus-platform/docs-creating-an-accesskey).

```Go
package main


import (
    "fmt"


    "github.com/bytedance/sonic"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/credentials"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/session"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/universal"
)


func main() {
    config := byteplus.NewConfig().WithCredentials(credentials.NewStaticCredentials("<your_ak>", "<your_sk>", "")).WithRegion("ap-southeast-1")
    sess, _ := session.NewSession(config)
    resp, err := universal.New(sess).DoCall(
        universal.RequestUniversal{
            ServiceName: "ark",
            Action:      "CreateAssetGroup",
            Version:     "2024-01-01",
            HttpMethod:  universal.POST,
            ContentType: universal.ApplicationJSON,
        },
        &map[string]any{
            "Name":        "<GROUP_NAME>",
            "Description": "<GROUP_DESC>",
            "ProjectName": "default",
        },
    )
    if err != nil {
        fmt.Printf("error: %v\n", err)
        return
    }
    if resp == nil {
        return
    }
    respData, err := sonic.Marshal(resp)
    fmt.Println(string(respData))
}
```


Response example:

```JSON
{
    "Id":"group-20260318033332-*****"
}
```



2. **Upload an asset**


Use the **POST** CreateAsset API to upload an asset.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The CreateAsset API is asynchronous. Processing may be queued, which can increase ingestion time. Upload\-time SLAs are <strong>not guaranteed</strong> .</div>


Provide the following in the request:


* **GroupId** : Required. Asset group ID.

* **URL** : Required. Accessible image URL.

* **AssetType** : Required. Support uploading image/video/audio assets. You need to specify the asset type here: **Image/Video/Audio** . For specific restrictions on asset files, see the [Assets API documentation](https://docs.byteplus.com/en/docs/ModelArk/2318271)[ ](https://docs.byteplus.com/en/docs/ModelArk/2318271) **.**

* **Name** : Optional. Asset name, which can be used for asset management, such as the asset file name.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Different models support different input audio and video durations. We recommend recording the duration of uploaded audio and video files before upload, so end users can identify which assets can be used with Dreamina Seedance 2.0 and Seedance 2.5 models.</div>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This field is used only for fuzzy search when calling the ListAssets API and is not included in model inference. For details on generating videos with assets, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2608626#preset-avatar">Use preset digital characters</a> and <a href="https://docs.byteplus.com/en/docs/ModelArk/2333565#785eb71a">3. How should I reference uploaded assets in the prompt (content.text)?</a></div>



* **Moderation** : Optional. Specifies whether to turn off the Content Pre\-filter review for the current asset.

   * By default, the Content Pre\-filter review is on.

   * To skip most non\-baseline content security review policies, set this parameter to `"Moderation": { "Strategy": "Skip"}`

* **ProjectName** : Optional. Specifies the resource project name. Defaults to **default** . Resources in a project can only be used by inference endpoints within that project. For more information about project, see the related [IAM docs](https://docs.byteplus.com/en/docs/byteplus-platform/docs-managing-projects).


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If <strong>ProjectName</strong> is not specified in the request, the asset will be uploaded to the <strong>default</strong> project by default. You need to use this field to ensure the asset is uploaded to the corresponding project.</div>


**Notes** :


* Each request uploads a single asset file.

* This request returns the asset ID. You can use the GetAsset API to view whether the upload was successful.

   ```Go
   package main


   import (
       "fmt"


       "github.com/bytedance/sonic"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/credentials"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/session"
       "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/universal"
   )


   func main() {
       config := byteplus.NewConfig().WithCredentials(credentials.NewStaticCredentials("<YOUR_AK>", "<YOUR_SK>", "")).WithRegion("ap-southeast-1")
       sess, _ := session.NewSession(config)
       resp, err := universal.New(sess).DoCall(
           universal.RequestUniversal{
               ServiceName: "ark",
               Action:      "CreateAsset",
               Version:     "2024-01-01",
               HttpMethod:  universal.POST,
               ContentType: universal.ApplicationJSON,
           },
           &map[string]any{
               "GroupId":     "group-20260324142802-f7wmx",
               "URL":         "<IMAGE_URL>",
               "AssetType":   "Image",
               "Moderation":  map[string]any{ // Skip the Content Pre-filter review, must turn off content pre-filter on the console first
                   "Strategy":   "Skip",
               },
               "ProjectName": "default",
           },
       )
       if err != nil {
           fmt.Printf("error: %v\n", err)
           return
       }
       if resp == nil {
           return
       }
       respData, err := sonic.Marshal(resp)
       fmt.Println(string(respData))
   }
   ```



Response example:

```JSON
{
    "Id": "asset-20260318071009-*****"
}
```


<span id="f838aa4e"></span>
## Retrieve virtual portraits (API & Console)

You can retrieve virtual portrait assets using the following methods.


* **Console** : In the [ModelArk Console](https://ai.byteplus.com/ark/region:ap-southeast-1/experience/vision?modelId=seedance-2-0-260128&tab=GenVideo) \> **My assets** \> **Virtual Portrait,**  you can search and view uploaded virtual portrait assets.

* **API** :

* **POST** GetAsset: Retrieve a single asset

* **POST** ListAssets: Query assets

* **POST** ListAssetGroups: Query asset group information


<span id="c63c40ce"></span>
### Retrieve information of a single asset

You can use **POST** GetAsset to retrieve information for a single asset by specifying the asset ID.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To obtain complete API parameters, rate limits, and other information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2333601">Virtual portrait library API reference</a>.</div>


```Go
package main


import (
    "fmt"


    "github.com/bytedance/sonic"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/credentials"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/session"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/universal"
)


func main() {
    config := byteplus.NewConfig().WithCredentials(credentials.NewStaticCredentials("<YOUR_AK>", "<YOUR_SK>", "")).WithRegion("ap-southeast-1")
    sess, _ := session.NewSession(config)
    resp, err := universal.New(sess).DoCall(
        universal.RequestUniversal{
            ServiceName: "ark",
            Action:      "GetAsset",
            Version:     "2024-01-01",
            HttpMethod:  universal.POST,
            ContentType: universal.ApplicationJSON,
        },
        &map[string]any{
            "Id":          "asset-20260324143042-*****",
            "ProjectName": "default", // Make sure to specify the correct project name where the asset is stored
        },
    )
    if err != nil {
        fmt.Printf("error: %v\n", err)
        return
    }
    if resp == nil {
        return
    }
    respData, err := sonic.Marshal(resp)
    fmt.Println(string(respData))
}
```


Response example:

```JSON
{
    "GroupId": "group-20260318033332-7vw4m",
    "Status": "Active",
    "Moderation": {
        "Strategy": "Default"
    },
    "CreateTime": "2026-03-18T03:57:10Z",
    "AssetType": "Image",
    "UpdateTime": "2026-03-18T03:57:14Z",
    "LastInferenceTime": "2026-07-24T10:08:49+08:00",
    "ProjectName": "default",
    "Id": "asset-20260318035710-*****",
    "Name": "",
    "URL": "https://ark-media-asset-ap-southeast-1.tos-ap-southeast-1.volces.com/300060****/03301616086559****.jpg?X-Tos-Algorithm=***********"
  }
```


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip"><code>LastInferenceTime</code> indicates the most recent time when an asset was used to submit a video generation task. The value is based on the time when the task was submitted. For details, see the <a href="https://docs.byteplus.com/en/docs/ModelArk/2318274">GetAsset API reference</a>.</div>


<span id="d1b9f674"></span>
### Query asset information

You can use **POST** ListAssets to query assets.

Supports:


* Querying by group ID (GroupId), asset statuses (Statuses), and asset name (Name). Filter assets that meet all criteria.

* Fuzzy search using Name and precise search using GroupId, making it easier to retrieve required assets.

* Sorting results using SortBy and SortOrder.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To obtain the complete API documentation, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2333601">Virtual portrait library API reference</a>.</div>


```Go
package main


import (
    "fmt"


    "github.com/bytedance/sonic"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/credentials"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/session"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/universal"
)


func main() {
    config := byteplus.NewConfig().WithCredentials(credentials.NewStaticCredentials("<your_ak>", "<your_sk>", "")).WithRegion("ap-southeast-1")
    sess, _ := session.NewSession(config)
    resp, err := universal.New(sess).DoCall(
        universal.RequestUniversal{
            ServiceName: "ark",
            Action:      "ListAssets",
            Version:     "2024-01-01",
            HttpMethod:  universal.POST,
            ContentType: universal.ApplicationJSON,
        },
        &map[string]any{
            "Filter": map[string]any{
                "GroupIds":  []string{"group-20260324142802-*****"},
                "GroupType": "AIGC",
                "Statuses":  []string{"Active", "Processing"}, // Supported statuses: Active (Upload successfully, Asset ID available for use), Processing, Failed
                "Name":      "<ASSET_NAME>", // Support fuzzy search
            },
            "PageNumber": 1,
            "PageSize":   10,
            "SortBy":     "GroupId",
            "SortOrder":  "Asc",
        },
    )
    if err != nil {
        fmt.Printf("list assets error: %v\n", err)
        return
    }
    if resp == nil {
        return
    }
    respData, err := sonic.Marshal(resp)
    fmt.Println(string(respData))
}
```


Response example:

```JSON
{
    "Items": [
      {
        "Id": "asset-20260318035710-kctzf",
        "Name": "",
        "AssetType": "Image",
        "CreateTime": "2026-03-18T03:57:10Z",
        "UpdateTime": "2026-03-18T03:57:14Z",
        "LastInferenceTime": "2026-07-24T10:08:49+08:00",
        "ProjectName": "default",
        "URL": "https://ark-media-asset-ap-southeast-1.tos-ap-southeast-1.volces.com/300060****/03301616086559****.jpg?X-Tos-Algorithm=***********",
        "GroupId": "group-20260318033332-*****",
        "Status": "Active",
        "Moderation": {
            "Strategy": "Default"
        }
      },
      {
        "GroupId": "group-20260318033332-*****",
        "Status": "Active",
        "Id": "asset-20260318034804-wtnjr",
        "Name": "",
        "URL": "image_url",
        "AssetType": "Image",
        "CreateTime": "2026-03-18T03:48:04Z",
        "UpdateTime": "2026-03-18T03:48:08Z",
        "LastInferenceTime": "2026-07-24T02:08:49Z",
        "ProjectName": "default",
        "Moderation": {
            "Strategy": "Default"
        }
      }
    ],
    "TotalCount": 2,
    "PageNumber": 1,
    "PageSize": 10
}
```


<span id="02c47673"></span>
### Query asset groups

Use **POST** ListAssetGroups to query asset group information.

Supports fuzzy search for asset group names (Name) or provides multiple asset groups (GroupId).

If there are multiple asset groups, the Name field can be used for fuzzy search.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To obtain the complete API reference, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2333601">Virtual portrait library API reference</a>.</div>


```Go
package main


import (
    "fmt"


    "github.com/bytedance/sonic"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/credentials"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/session"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus/universal"
)


func main() {
    config := byteplus.NewConfig().WithCredentials(credentials.NewStaticCredentials("<YOUR_AK>", "<YOUR_SK>", "")).WithRegion("ap-southeast-1")
    sess, _ := session.NewSession(config)
    resp, err := universal.New(sess).DoCall(
        universal.RequestUniversal{
            ServiceName: "ark",
            Action:      "ListAssetGroups",
            Version:     "2024-01-01",
            HttpMethod:  universal.POST,
            ContentType: universal.ApplicationJSON,
        },
        &map[string]any{
            "Filter": map[string]any{
                "Name":      "<FIGURE_GROUP>", // Support fuzzy search
                "GroupIds":  []string{"group-20260324142802-*****"},
                "GroupType": "AIGC",
            },
            "PageNumber": 1,
            "PageSize":   10,
        },
    )
    if err != nil {
        fmt.Printf("error: %v\n", err)
        return
    }
    if resp == nil {
        return
    }
    respData, err := sonic.Marshal(resp)
    fmt.Println(string(respData))
}
```


Return example:

```JSON
{
    "TotalCount": 1,
    "Items": [
      {
        "UpdateTime": "2026-03-18T03:33:32Z",
        "Id": "group-20260318033332-*****",
        "Name": "figure_group_1",
        "Title": "figure_group_1",
        "Description": "Figure group 1",
        "GroupType": "AIGC",
        "ProjectName": "default",
        "CreateTime": "2026-03-18T03:33:32Z"
      }
    ],
    "PageNumber": 1,
    "PageSize": 10
}
```


<span id="6bd17b44"></span>
### Update/delete assets or asset group

You can call `UpdateAsset`, `UpdateAssetGroup`, `DeleteAsset`, and `DeleteAssetGroup` to update or delete assets and asset groups. For details, see [Virtual portrait library API reference](https://docs.byteplus.com/en/docs/ModelArk/2333601).

We recommend periodically checking `LastInferenceTime` by using `GetAsset` or `ListAssets`, and proactively deleting assets that you have confirmed are no longer used by using `DeleteAsset`. If an entire asset group is no longer needed, you can call `DeleteAssetGroup`. If `LastInferenceTime` is not returned, it only means that the asset has no invocation record after 2026\-07\-24. Do not use this field alone to determine that the asset has never been used. Before deletion, confirm against your own business records. Deletion cannot be undone.

<span id="28a8c5b5"></span>
## Example: Upload assets and use GetAsset to retrieve asset information

The following example creates an asset, queries the asset Status, and determines whether to continue querying or return the corresponding result based on the status.

The code executes the following logic:


1. createAsset: Upload resources and obtain AssetId

2. waitForAssetActive: Start querying and repeatedly call getAssetStatus to check the current asset status

3. Determine based on Status

   * Processing → Continue polling

   * Active → Return URL (end). Once the status is **Active** , the Asset ID (in URI format) can be used for video generation.

   * Failed → Return error (end)

4. Return the result and print the output


<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c79a4a0bb29c43c0a5de89d3412ddccc~tplv-goo7wpa0wc-image.image" name="BP_Upload_Asset_Get_Info.go">BP_Upload_Asset_Get_Info.go</Attachment>


The query result is illustrated as follows:

```text
asset status: Active
asset is active, URL =
asset is active, URL = https://ark-media-asset-ap-southeast-1.tos-ap-southeast-1.volces.com/300060****/03301616086559****.jpg?X-Tos-Algorithm=***********
```


<span id="a6f37039"></span>
## Sample code in other programming languages

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/178000f123e844ebbb1405a91073fafe~tplv-goo7wpa0wc-image.image" name="bp-demo.zip">bp-demo.zip</Attachment>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Caution: Replace the AK and SK in the Demo. To call other interfaces such as ListAssets, replace ACTION and the corresponding request parameters.</div>


<span id="5a7806b3"></span>
## Generate video using portrait assets

After obtaining the Asset ID, private portrait assets can be used to generate video.

For details, see [Use preset digital characters](https://docs.byteplus.com/en/docs/ModelArk/2608626#preset-avatar).

Use the asset URI in the **content._url.url**field of the Video Generation API to generate video.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Asset URI pattern: asset:// <strong><Asset_Id\></strong></div>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">In the prompt you send to the model, reference assets using <strong>type + index</strong> , such as <strong>Image 1</strong> and <strong>Video 1</strong> . The index is the asset's position in the request body.</div>


<div data-tips="true" data-tips-type="tip"><strong>Do not</strong> use an Asset ID directly in the prompt.</div>


<div data-tips="true" data-tips-type="tip">Example: "The girl in <strong>Image 1</strong> is wearing the outfit from <strong>Image 2</strong> and is arranging items on the counter. The boy in <strong>Image 3</strong> is a customer who walks up and asks the girl for her contact information."</div>


<div data-tips="true" data-tips-type="tip">For a complete call example, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2333565#785eb71a">3. How should I reference uploaded assets in the prompt (content.text)?</a></div>


Sample code:

```Python
import os
import time
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark
client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    # Get API Key: https://ai.byteplus.com/ark/region:ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)
if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", # Replace with Model ID
        content=[
            {
                "type": "text",
                "text": "Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. English voiceover: 'I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!' "
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "asset://asset-20260225023032-gnzwk"
                },
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_ref_image.png"
                },
                "role": "reference_image"
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)
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
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```


<span id="480989d7"></span>
## FAQs

<span id="8f894b5a"></span>
#### 1. Why is it not possible to generate video or retrieve asset information after assets are uploaded successfully?

The asset library is isolated by **Project (ProjectName)**  .


* When generating video, inference must be performed using the inference endpoint in the **project where the asset resides** .

* If the asset upload is successful but retrieving the asset via the API fails, it may be because different **ProjectName** values were provided when calling the upload asset (CreateAsset) and retrieve asset APIs.

   * The default value for **ProjectName** is default. If this field is not specified, resources are created in the default project by default.

   * It is recommended to manage assets within the same project.


For more information about project, see the related [IAM docs](https://docs.byteplus.com/en/docs/byteplus-platform/docs-managing-projects).

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If <strong>ProjectName</strong> is not specified in the request, the asset group will be created in the <strong>default</strong> project by default.</div>


<span id="dbacdf1e"></span>
#### 2. How to manage user permissions for the asset library?

You can use [Access control](https://console.byteplus.com/iam/identitymanage/user) (IAM) to finely manage user actions in the asset library. Settings can be configured as follows:


1. **Create a custom policy**

   1. Open [Access control](https://console.byteplus.com/iam/policymanage) \> **Create policy**

   2. Input the policy name.

   3. Switch to the **JSON editor** , paste the custom policy below into the editor, and click **submit** to save.


<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/aaa972e2485e4728b76ce685aca26c33~tplv-goo7wpa0wc-image.image) </span>

```JSON
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ark:*Asset*"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
```



2. **Grant permissions to users/user groups**

   1. Click **User management** \> **User** / **User group** , select the user or user group to grant permissions to, and click **Authorize.**

   2. In **Policy** , select the policy created in **Step 1** .

   3. (Optional) In **Limit to project resources** , select the project to which the policy applies.

   4. Click **submit.**


After completing the above actions, the user or user group can manage assets in the corresponding project.

For more information about IAM, please refer to the [IAM docs](https://docs.byteplus.com/en/docs/byteplus-platform/docs-overview-3).

<span id="785eb71a"></span>
#### 3. How should I reference uploaded assets in the prompt (`content.text`)?

In the prompt, reference assets using the format  **“asset type + index”**  , for example: **Image 1** , **Video 1** , **Audio 1** . The index is the position of that asset within the same asset type in the request body.

**Note** : Do not reference assets by **Asset ID** in the prompt.

For example, the sample below includes **five** reference images and **one** reference audio file. Use the prompt format in the example to reference these assets.


* **Reference** :



<columns>
<columnsItem zoneid="yk7486QPt8">


<card mode="container" iconsize="m" align="left" >

<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bc3f0a1951c94cd282c690d2f8a938e0~tplv-goo7wpa0wc-image.image" width="426px" /></div>


Image 1

</card>



</columnsItem>
<columnsItem zoneid="FmJsx96RN2">


<card mode="container" iconsize="m" align="left" >

<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c9b934d1e50246cdb840318f59e4f00a~tplv-goo7wpa0wc-image.image" width="157px" /></div>


Image 2

</card>



</columnsItem>
<columnsItem zoneid="pWvVhlBCJT">


<card mode="container" iconsize="m" align="left" >

<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e987f41012a24a6fa8e746126916a933~tplv-goo7wpa0wc-image.image" width="534px" /></div>


Image 3

</card>



</columnsItem>
<columnsItem zoneid="JMaIWpGTIi">


<card mode="container" iconsize="m" align="left" >

<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f74e55364f664c67885761a1a02648ae~tplv-goo7wpa0wc-image.image" width="674px" /></div>


Image 4

</card>



</columnsItem>
<columnsItem zoneid="okJ2TiGKbY">


<card mode="container" iconsize="m" align="left" >

<div style="text-align: center">
<img src="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1ed8333cf28649e9a6efdef54529e436~tplv-goo7wpa0wc-image.image" width="574px" /></div>


Image 5

</card>



</columnsItem>
</columns>



* **Prompt** :


```Plain
Create a fresh, creamy-painting–style short drama with a light, upbeat guitar track driving quick beat cuts. Use a cream-white base with peach-pink highlights, soft lighting, no visual effects—emotion conveyed through expressions. 0–2s: Two fast cuts: the CEO from Image 1 accidentally bumps into the female lead wearing the outfit from Image 2 (character from Image 3); they freeze and lock eyes, then a hand close-up as the CEO pulls off his suit jacket and drapes it over her shoulders. Gentle guitar starts; soft SFX of a coffee cup dropping and fabric brushing. 2–6s: Three fast cuts: the female lead, wrapped in his jacket, looks down and smiles shyly (cheeks flushed, close-up); the CEO watches her back with a faint smile and says “我们一起走吧,” voice style referenced from Audio 1 (profile shot); the two share a black umbrella in the rain, fingertips touch then quickly pull back (near shot). Rainy backdrop references Image 4; each cut hits a light drum accent with rain and umbrella SFX, a subtle soft-mist look. 6–8s: Slow-motion eye-contact smiles; the text portion from Image 5 appears at the lower right, with small text “NEW EP DAILY” at the lower left. Minimal pale-pink petals drift; the guitar resolves gently as the frame freezes on their side-by-side profiles.
```



* **cURL** :

   ```Bash
   curl --location 'https://ark.ap-southeast-1.bytepluses.com/api/v3/contents/generations/tasks' \
       -X POST \
       -H 'Content-Type: application/json' \
       -H 'Authorization: Bearer $ARK_API_KEY' \
       -d '{
       "model": "seedance-2-0-260128",
       "content": [
           {
               "type": "text",
               "text": "Create a fresh, creamy-painting–style short drama with a light, upbeat guitar track driving quick beat cuts. Use a cream-white base with peach-pink highlights, soft lighting, no visual effects—emotion conveyed through expressions. 0–2s: Two fast cuts: the CEO from 【Image 1】 accidentally bumps into the female lead wearing the outfit from 【Image 2】 (character from 【Image 3】); they freeze and lock eyes, then a hand close-up as the CEO pulls off his suit jacket and drapes it over her shoulders. Gentle guitar starts; soft SFX of a coffee cup dropping and fabric brushing. 2–6s: Three fast cuts: the female lead, wrapped in his jacket, looks down and smiles shyly (cheeks flushed, close-up); the CEO watches her back with a faint smile and says “我们一起走吧,” voice style referenced from 【Audio 1】 (profile shot); the two share a black umbrella in the rain, fingertips touch then quickly pull back (near shot). Rainy backdrop references 【Image 4】; each cut hits a light drum accent with rain and umbrella SFX, a subtle soft-mist look. 6–8s: Slow-motion eye-contact smiles; the text portion from 【Image 5】 appears at the lower right, with small text “NEW EP DAILY” at the lower left. Minimal pale-pink petals drift; the guitar resolves gently as the frame freezes on their side-by-side profiles."
           },
           {
               "type": "image_url",
               "role": "reference_image",
               "image_url": {
                   "url": "asset://asset-20260224213248-ghm5g"
               }
           },
           {
               "type": "image_url",
               "role": "reference_image",
               "image_url": {
                   "url": "asset://asset-20260224213248-4lb57"
               }
           },
           {
               "type": "image_url",
               "role": "reference_image",
               "image_url": {
                   "url": "asset://asset-20260224213248-rc7b7"
               }
           },
           {
               "type": "image_url",
               "role": "reference_image",
               "image_url": {
                   "url": "asset://asset-20260224213248-wpgsn"
               }
           },
           {
               "type": "image_url",
               "role": "reference_image",
               "image_url": {
                   "url": "asset://asset-20260224213248-9wrmp"
               }
           },
           {
               "type": "audio_url",
               "role": "reference_audio",
               "audio_url": {
                   "url": "asset://asset-20260224213248-g5nv7"
               }
           }
       ],
       "generate_audio": true,
       "ratio": "16:9",
       "duration": 11,
       "watermark": false
   }'
   ```





