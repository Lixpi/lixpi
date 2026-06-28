This article introduces the main advantages, supported models, and purchase instructions for model units.

<span id="b2c2eaa5"></span>
# Main advantages

Model units are mainly used for large\-scale inference of fine\-tuned models.


* **Offers exclusive computing resources for more stable and reliable performance.** 

* **Highly flexible, allowing users to choose the most suitable resource model for their needs based on concurrency, latency, and cost.** 

   * **Deployment templates**: The ModelArk platform provides multiple machine types, each offering different computing resources and applicable models. To help users quickly find the best solution, the platform offers optimal deployment combinations tailored for different models, covering various scenarios. e.g.: single\-machine deployment, dual\-model separation deployment, triple\-model separation deployment, and more. Users do not need to configure model types manually—just choose the appropriate template based on actual needs to complete deployment.

   * **Two billing types**: For fixed services, users can select monthly resources; for users with cyclical traffic fluctuations or temporary needs, hourly billing is available. You can also combine both billing items.

   * **Custom auto\-scaling coefficient**: Each deployment template supports multiple auto\-scaling coefficients, letting you define your own redundancy rules and personalize latency requirements. TTFT (Time To First Token) and TPOT (Time Per Output Token) latency definitions are supported.

* **Optimize costs with flexible scaling strategies, preventing resource waste during business lulls.** 

   * **Support for auto\-scaling rules**, significantly reducing resource consumption and helping users save costs overnight.

   * Supports both monthly and hourly billing modes, allowing flexible combinations to help reduce resource waste.

   * A model unit now supports **local transparent caching** by default, which increases single\-resource capacity after cache hits and reduces the total number of resources needed.


<span id="b03cdbd5"></span>
# Application scenarios

Typical application scenarios include:


* Online production service, which requires high certainty of resources and resource guarantee at peak traffic.

* Lower latency in inference after LoRA\-based fine\-tuning is performed on the model.

* Lower latency in inference after full fine\-tuning is performed on the model.

* High concurrency exists in actual business, and the TPM and Requests per Minute (RPM) exceed the default limit of the ModelArk platform.


<span id=".5pSv5oyB5qih5Z6L5Y2V5YWD55qE5qih5Z6L"></span>
# Model List

> Supports online inference for base models, models fine\-tuned with LoRA, and models fine\-tuned with full data.


* seed\-1\-6\-250615

* seed\-1\-6\-flash\-250615


Note: The actual supported models are based on what is displayed in the console. To get support for more model versions, submit a [Ticket](https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514).

<span id="79b43c4d"></span>
# Instructions


* The estimated performance of model units (Tokens Per Second, TPS) is measured using input:output = 10:1 in performance testing. Many factors can affect the actual resource capacity. After purchase, we recommend running stress tests using your business’s real traffic to determine the true throughput of model units.

* The inference performance of models fine\-tuned with LoRA may decrease compared to platform preset models.

* Model units do not support use with the structured output feature.


<span id="36f36ae6"></span>
# Billing

Model unit pricing is based on the selected instance type and usage duration. Both postpaid by hour and prepaid monthly options are supported and can be combined. For unit price, please refer to [Model Unit](https://docs.byteplus.com/en/docs/ModelArk/1099320#b7d75b31).

<span id="b4691cfa"></span>
## Billing method comparison


|Billing Method |Postpaid |Prepaid |
|---|---|---|
|Billing Features |Charged by actual usage time, accurate to the second |Monthly reserved resources, enjoy more favorable prices |
|Auto\-scaling Configuration |Supported |\- |
|Suitable Scenarios |Suitable for short\-term or auto\-scaling demand |Medium to long\-term stable demand |


<span id="a129c08a"></span>
## **Postpaid (hourly)** 


* **Billing features**: Charges are based on actual purchase duration, with billing precision down to the second. Billing continues after purchase. To stop billing, unsubscribe on the endpoint details page.


e.g.: If you place an order successfully at 16:00 and unsubscribe successfully at 18:20:31. The billing duration is 2 hours, 20 minutes, and 31 seconds. The billing unit price will be calculated per second.


* **Billing granularity**: second. Any duration less than one second is billed as one second.

* **Billing cycle**: Hourly settlement. Bills are typically issued 1–2 hours after the end of the current billing cycle, subject to the system's actual issue time. e.g.: Bills for 16:00–17:00 are usually issued between 18:00 and 19:00.

* **Overdue fee notice**: After an account becomes overdue, resources will remain available and continue to generate fees. Resources will be reclaimed and billing will stop 24 hours after they become overdue. Renew or destroy your resources promptly.


<span id="0143fea2"></span>
## **Prepaid (monthly)** 


* **Activation time**: After purchase, services take effect immediately according to the calendar day.

* **Expiration time**: Starting from the purchase date, the expiration time is 12 noon on the day after the calendar\-day expiration date. A reminder will be displayed for model units expiring in seven days.

* **Expiration reclamation**: Resources are reclaimed after their expiration date. You can renew them in the ModelArk product console or on the [order management page](https://console.byteplus.com/finance/order) before reclamation. The reclamation time is expiration time + 24 hours. For example, if you purchase a model unit for one month on April 13 at 9 a.m., it will expire at 12 noon on May 14, and the resource will be reclaimed at 12 noon on May 15. You can renew your subscription until 12:00 PM on May 15. After the grace period ends, you cannot renew the model unit. You need to create a new inference endpoint to continue using the service.

* **Renewal instructions**: Automatic renewal for resources is strongly recommended to avoid service interruptions caused by not enabling automatic renewal.

    &nbsp;


<span id="purchase-process"></span>
# **Purchase process**


1. Request access to the model unit feature.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This is an invitation\-only testing capability. To use it, submit <a href="https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514">the test application ticket</a>.</div>



2. Go to [ModelArk Console – Online Inference](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint?config=%7B%7D), switch to the **Custom Inference Endpoint** tab, and click **Create Inference Endpoint**.

3. Fill in the endpoint name, select the model type, and set the purchase option to **Model Unit** on the page that opens.

   <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/632ddc3cdbb548278520fae6c81f298a~tplv-goo7wpa0wc-image.image) </span>

4. Use the [Model Unit Calculator](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint/create) to estimate the number of model units you need and [apply for quota](https://console.byteplus.com/ark/region:ark+ap-southeast-1/quota?quota=%7B%22business%22%3A%22Endpoint%22%2C%22quota%22%3A%22ModelUnit%22%2C%22table%22%3A%7B%7D%7D).

5. Configure other configuration items such as Billing type, Deployment method, and Auto\-scaling.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">We recommend turning on the <strong>Guide Mode</strong> toggle in the upper right corner to learn about each configuration item's usage scenarios and meaning, making it easy to order model units.</div>



6. Select the agreement and click **Create and Access** to place your order.


<span id="b3374a0e"></span>
# Adjust quantity / renew / unsubscribe


1. Go to [ModelArk Console – Online Inference](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint) and switch to the **Custom Inference Endpoint** tab.

2. Click the target endpoint name to go to the endpoint Overview page. In the **Compute Guarantee** section, adjust quantity, renew, or unsubscribe model units as needed.


<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1b89ae88c0ff41d38a114b3ab43141cd~tplv-goo7wpa0wc-image.image) </span>

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>



* <div data-tips="true" data-tips-type="warning">Model units are purchased by instance group. The model unit ID copied from endpoint Overview page is the instance group ID. Instance groups have strong association relationships, so renewal and unsubscribe actions must be initiated simultaneously.</div>


* <div data-tips="true" data-tips-type="warning">Note that unsubscribing from model units that are not due will incur a penalty, which means you won't get a full refund.</div>



<span id="a81b7630"></span>
# Edit auto\-scaling rule

For postpaid model units charged hourly, you can edit auto\-scaling rules on the endpoint details page.


1. Go to [ModelArk Console – Online Inference](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint) and switch to the **Custom Inference Endpoint** tab.

2. Click the target endpoint name to go to the endpoint Overview page. In the **Compute Guarantee** section, click **Adjust** to modify auto\-scaling rules for postpaid model units.


<span id="efa8559e"></span>
# Subscribe to status\-change events

You can use BytePlus' [Message Notification Service (SNS)](https://console.byteplus.com/sns/) to subscribe to critical status change events for model units. In cases such as model unit purchase failure, scale\-up failure, or automatic shutdown due to no traffic, the platform will automatically push notifications to the configured receiving endpoint.

Supported events currently include:


* `ModelPTUNewFailed`: Failed to place or purchase a model unit order

* `ModelPTUScaleUpFailed`: Failed to scale up a model unit

* `ModelPTUNolnferAutoTermWarn`: Model unit auto\-termination / intelligent sleep due to no traffic


<span id="08e5f6f2"></span>
#### Subscription process


1. Submit a support ticket to enable SNS and synchronize the application for the above events.

2. Create a topic on the **Topic** page.

   * Publisher: Specify the publishers

   * Service that can publish messages: `ark`

   <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0c0886aeb99a4b2aa344a580755504f8~tplv-goo7wpa0wc-image.image) </span>

3. Create an event subscription on the **Cloud event sub** page.

   * Product service: `ark`

   * Topic TRN: Select the topic just created

   * Event type: Select the Model Unit related events

4. Create a subscription to subscribe to the topic you just created.

   * Push type: HTTP or HTTPS

   * Receiver address: The address that receives notifications.

   <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f626f8d796494a17b5ead2dff1a935a9~tplv-goo7wpa0wc-image.image) </span>


**Note**: After the subscription configuration, SNS will send a confirmation link to the receiver. You need to call back the `SubscribeURL` to confirm.

> You can also subscribe to information using [function services](https://console.byteplus.com/vefaas).

> In **Push type**, select function service.


5. After the callback is successful, the status of the subscription will become `confirmed`, indicating that the subscription has been completed.


<span id="8f46c40a"></span>
# FAQs

See [Model Unit](https://docs.byteplus.com/en/docs/ModelArk/1359411#0a1e4d96) FAQs.



