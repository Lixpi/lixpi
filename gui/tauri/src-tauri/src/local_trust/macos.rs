// Answers WebKit's server-trust challenges for the local stack. wry's
// navigation delegate doesn't implement
// `webView:didReceiveAuthenticationChallenge:completionHandler:`, so this
// module adds that method to the delegate's class and sets the delegate again,
// which makes WebKit see the new method. The method checks a `localhost`
// certificate chain against the embedded authority with the system's TLS
// policy, and leaves every other challenge to the system.
#![expect(
    unsafe_code,
    reason = "WebKit's authentication challenge is only reachable through the Objective-C runtime"
)]

use std::ptr;

use block2::Block;
use objc2::{
    class,
    ffi,
    msg_send,
    rc::Retained,
    runtime::{
        AnyClass,
        AnyObject,
        Imp,
        Sel,
    },
    sel,
};
use objc2_core_foundation::{
    CFArray,
    CFData,
};
use objc2_foundation::{
    NSString,
    NSURLAuthenticationChallenge,
    NSURLAuthenticationMethodServerTrust,
};
use objc2_security::{
    SecCertificate,
    SecTrust,
};
use tauri::webview::PlatformWebview;

use super::anchor_for;

// NSURLSessionAuthChallengeDisposition values.
const USE_CREDENTIAL: isize = 0;
const PERFORM_DEFAULT_HANDLING: isize = 1;

type CompletionHandler = Block<dyn Fn(isize, *mut AnyObject)>;

type ChallengeMethod = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut NSURLAuthenticationChallenge, *mut CompletionHandler);

pub(super) fn install(webview: &PlatformWebview) -> Result<(), String> {
    let native = webview
        .downcast_ref::<tauri_runtime_wry::Webview>()
        .ok_or("the window does not use the WebKit runtime")?;
    let wk_web_view = native.inner().cast::<AnyObject>().cast_mut();
    if wk_web_view.is_null() {
        return Err(String::from("the window has no web view"));
    }

    // SAFETY: `wk_web_view` is the window's live WKWebView, and this runs on the
    // main thread through `with_webview`, as WebKit requires.
    let delegate: *mut AnyObject = unsafe { msg_send![wk_web_view, navigationDelegate] };
    if delegate.is_null() {
        return Err(String::from("the web view has no navigation delegate"));
    }

    let method: ChallengeMethod = did_receive_authentication_challenge;

    // SAFETY: Both are `unsafe extern "C-unwind"` function pointers; the
    // runtime calls the method with the argument list `ChallengeMethod`
    // declares, which the type encoding below describes.
    let implementation = unsafe { std::mem::transmute::<ChallengeMethod, Imp>(method) };

    // SAFETY: `delegate` is a live object, so the runtime returns its class.
    let class = unsafe { ffi::object_getClass(delegate) }.cast_mut().cast::<AnyClass>();
    // SAFETY: `class` is the delegate's class. The selector, implementation and
    // encoding (void return; self, _cmd, web view, challenge, block) describe
    // the same method. Adding a method that already exists returns NO and
    // changes nothing, so a second window is harmless.
    let _added = unsafe {
        ffi::class_addMethod(
            class,
            sel!(webView:didReceiveAuthenticationChallenge:completionHandler:),
            implementation,
            c"v@:@@@?".as_ptr(),
        )
    };

    // WebKit records which delegate methods exist when the delegate is set.
    // SAFETY: Same web view and thread as above; `delegate` stays alive because
    // wry owns it for the web view's lifetime.
    let () = unsafe { msg_send![wk_web_view, setNavigationDelegate: delegate] };

    Ok(())
}

unsafe extern "C-unwind" fn did_receive_authentication_challenge(
    _delegate: *mut AnyObject,
    _command: Sel,
    _web_view: *mut AnyObject,
    challenge: *mut NSURLAuthenticationChallenge,
    completion: *mut CompletionHandler,
) {
    // SAFETY: WebKit passes a live challenge, valid for the duration of this
    // call.
    let Some(challenge) = (unsafe { challenge.as_ref() }) else {
        return;
    };

    // SAFETY: WebKit passes a live completion handler, valid for the duration
    // of this call.
    let Some(completion) = (unsafe { completion.as_ref() }) else {
        return;
    };

    match local_credential(challenge) {
        Some(credential) => completion.call((USE_CREDENTIAL, Retained::as_ptr(&credential).cast_mut())),
        None => completion.call((PERFORM_DEFAULT_HANDLING, ptr::null_mut())),
    }
}

// A credential for the server's trust when it is a local host whose chain
// leads to the embedded authority under the system's TLS policy.
fn local_credential(challenge: &NSURLAuthenticationChallenge) -> Option<Retained<AnyObject>> {
    let space = challenge.protectionSpace();

    let method = space.authenticationMethod();
    // SAFETY: Foundation defines this constant for the process's lifetime.
    let server_trust: &NSString = unsafe { NSURLAuthenticationMethodServerTrust };
    if &*method != server_trust {
        return None;
    }

    let authority = anchor_for(&space.host().to_string())?;

    // SAFETY: A server-trust protection space always answers `serverTrust`
    // with a SecTrustRef it owns for the challenge's lifetime.
    let trust: *mut SecTrust = unsafe { msg_send![&*space, serverTrust] };
    // SAFETY: The pointer is null or a live SecTrust, as above.
    let trust = unsafe { trust.as_ref() }?;
    // SAFETY: `SecCertificateCreateWithData` copies the bytes and returns None
    // for data that isn't a DER certificate.
    let certificate = unsafe { SecCertificate::with_data(None, &CFData::from_bytes(authority)) }?;
    let anchors = CFArray::from_retained_objects(&[certificate]);

    // SAFETY: The array holds SecCertificate objects only, as the call
    // requires.
    let anchored = unsafe { trust.set_anchor_certificates(Some(anchors.as_ref())) } == 0;
    // SAFETY: `trust` is live. Keeping the system anchors too leaves a
    // keychain-installed authority working as before.
    let system_kept = unsafe { trust.set_anchor_certificates_only(false) } == 0;
    // SAFETY: `trust` is live, and a null error pointer asks for no error
    // object.
    let trusted = anchored && system_kept && unsafe { trust.evaluate_with_error(ptr::null_mut()) };
    if !trusted {
        return None;
    }

    // SAFETY: `credentialForTrust:` takes a live SecTrustRef and returns an
    // autoreleased NSURLCredential, which `Retained` retains.
    Some(unsafe { msg_send![class!(NSURLCredential), credentialForTrust: ptr::from_ref(trust)] })
}
