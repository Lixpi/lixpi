// Vite sends each rebuilt module to the page over a WebSocket, and reloads the
// page when a change can't be applied in place. The window loads web-ui from
// the dev server the way a browser does, so a build with the `hot-reload`
// feature picks up every change web-ui rebuilds. A build without it keeps the
// page as it loaded until Cmd+R reloads it: a script that runs before any page
// script refuses the WebSockets Vite opens for updates, which carry the
// `vite-hmr` and `vite-ping` subprotocols. A production web-ui has no Vite
// client, so the script finds nothing to refuse there.

const ENABLED: bool = cfg!(feature = "hot-reload");

const REFUSE_SCRIPT: &str = r"
(() => {
  const hotReloadProtocols = new Set(['vite-hmr', 'vite-ping'])

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args, newTarget) {
      if ([args[1]].flat().some(protocol => hotReloadProtocols.has(protocol)))
        throw new DOMException('Hot reload is off in this build of the desktop app', 'NotAllowedError')

      return Reflect.construct(target, args, newTarget)
    },
  })
})()
";

// The script the window installs for this build, if any.
pub(crate) fn initialization_script() -> Option<&'static str> {
    script(ENABLED)
}

fn script(enabled: bool) -> Option<&'static str> {
    if enabled {
        return None;
    }

    Some(REFUSE_SCRIPT)
}

#[cfg(test)]
mod tests {
    use super::script;

    #[test]
    fn a_hot_reload_build_leaves_the_page_alone() {
        assert_eq!(script(true), None);
    }

    #[test]
    fn a_build_without_hot_reload_refuses_both_vite_sockets() {
        let refuse = script(false).unwrap_or_default();

        for protocol in ["'vite-hmr'", "'vite-ping'"] {
            assert!(refuse.contains(protocol), "{protocol}");
        }
    }
}
