use crate::{Release, ReleaseClient};
use serde::Deserialize;
use std::{collections::BTreeMap, io::Read, time::Duration};
use url::Url;
const LATEST: &str = "https://api.github.com/repos/salan70/docbridge/releases/latest";
const MAX_REDIRECTS: usize = 5;

/// One HTTP response as seen by the release client. Redirects are never followed by
/// the transport itself; `get_limited` validates every hop.
pub(crate) struct Response {
    pub(crate) status: u16,
    pub(crate) location: Option<String>,
    pub(crate) body: Box<dyn Read>,
}
/// Minimal HTTP seam so redirect, allowlist and size policy is testable without network.
pub(crate) trait Transport {
    fn get(&self, url: &Url, accept: &str) -> Result<Response, String>;
}
/// HTTPS via rustls with the bundled webpki-roots trust anchors (no OS trust store).
struct UreqTransport {
    agent: ureq::Agent,
}
impl UreqTransport {
    fn new() -> Self {
        Self {
            // Connect and per-read timeouts instead of one overall deadline, so a slow but
            // progressing download of a large asset is not cut off.
            agent: ureq::AgentBuilder::new()
                .redirects(0)
                .timeout_connect(Duration::from_secs(30))
                .timeout_read(Duration::from_secs(60))
                .timeout_write(Duration::from_secs(60))
                .build(),
        }
    }
}
impl Transport for UreqTransport {
    fn get(&self, url: &Url, accept: &str) -> Result<Response, String> {
        let response = match self
            .agent
            .get(url.as_str())
            .set("User-Agent", "docbridge-updater")
            .set("Accept", accept)
            .call()
        {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(e) => return Err(format!("release network failure: {e}")),
        };
        Ok(Response {
            status: response.status(),
            location: response.header("Location").map(str::to_owned),
            body: response.into_reader(),
        })
    }
}

pub struct OfficialClient {
    transport: Box<dyn Transport>,
}
impl Default for OfficialClient {
    fn default() -> Self {
        Self {
            transport: Box::new(UreqTransport::new()),
        }
    }
}
fn permitted(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.fragment().is_none()
        && matches!(
            url.host_str(),
            Some(
                "api.github.com"
                    | "github.com"
                    | "objects.githubusercontent.com"
                    | "release-assets.githubusercontent.com"
            )
        )
}
/// Follows at most `MAX_REDIRECTS` redirects, checking every URL against the allowlist
/// before it is requested, and reads at most `limit` bytes of a 200 response.
fn get_limited(transport: &dyn Transport, initial: &str, limit: u64) -> Result<Vec<u8>, String> {
    let mut url = Url::parse(initial).map_err(|e| e.to_string())?;
    for _ in 0..=MAX_REDIRECTS {
        if !permitted(&url) {
            return Err("untrusted release HTTPS URL/redirect".into());
        }
        let accept = if url.host_str() == Some("api.github.com") {
            "application/vnd.github+json"
        } else {
            "application/octet-stream"
        };
        let response = transport.get(&url, accept)?;
        if matches!(response.status, 301 | 302 | 303 | 307 | 308) {
            let location = response.location.ok_or("redirect without Location")?;
            url = url.join(&location).map_err(|e| e.to_string())?;
            continue;
        }
        if response.status != 200 {
            return Err(format!("unexpected release status {}", response.status));
        }
        let mut bytes = Vec::new();
        response
            .body
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("release download interrupted: {e}"))?;
        if bytes.len() as u64 > limit {
            return Err("release response exceeds size limit".into());
        }
        return Ok(bytes);
    }
    Err("too many release redirects".into())
}
#[derive(Deserialize)]
struct Metadata {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    assets: Vec<MetadataAsset>,
}
#[derive(Deserialize)]
struct MetadataAsset {
    name: String,
    browser_download_url: String,
}
fn official_asset_url(tag: &str, name: &str) -> String {
    let mut url = Url::parse("https://github.com").expect("constant URL");
    url.path_segments_mut().expect("hierarchical URL").extend([
        "salan70",
        "docbridge",
        "releases",
        "download",
        tag,
        name,
    ]);
    url.to_string()
}
fn size_limit(filename: &str) -> u64 {
    if filename.ends_with(".json") {
        1024 * 1024
    } else if filename.ends_with(".sig") {
        64
    } else {
        256 * 1024 * 1024
    }
}
impl ReleaseClient for OfficialClient {
    fn latest(&self) -> Result<Release, String> {
        let raw = get_limited(self.transport.as_ref(), LATEST, 2 * 1024 * 1024)?;
        let metadata: Metadata =
            serde_json::from_slice(&raw).map_err(|e| format!("invalid release metadata: {e}"))?;
        let mut assets = BTreeMap::new();
        for asset in metadata.assets {
            if asset.browser_download_url != official_asset_url(&metadata.tag_name, &asset.name)
                || assets
                    .insert(asset.name, asset.browser_download_url)
                    .is_some()
            {
                return Err("untrusted or duplicate release asset URL".into());
            }
        }
        Ok(Release {
            tag: metadata.tag_name,
            prerelease: metadata.prerelease,
            draft: metadata.draft,
            assets,
        })
    }
    fn fetch(&self, release: &Release, filename: &str) -> Result<Vec<u8>, String> {
        let url = release
            .assets
            .get(filename)
            .ok_or_else(|| format!("missing release asset {filename}"))?;
        if *url != official_asset_url(&release.tag, filename) {
            return Err("untrusted release asset URL".into());
        }
        get_limited(self.transport.as_ref(), url, size_limit(filename))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque, io::Cursor};

    type Reply = Result<(u16, Option<&'static str>, Vec<u8>), String>;
    /// Scripted transport: pops one canned reply per request and records requested URLs.
    #[derive(Default)]
    struct Fake {
        replies: RefCell<VecDeque<Reply>>,
        requested: RefCell<Vec<String>>,
    }
    impl Fake {
        fn reply(self, status: u16, location: Option<&'static str>, body: &[u8]) -> Self {
            self.replies
                .borrow_mut()
                .push_back(Ok((status, location, body.to_vec())));
            self
        }
        fn fail(self, message: &str) -> Self {
            self.replies.borrow_mut().push_back(Err(message.into()));
            self
        }
        fn requested(&self) -> Vec<String> {
            self.requested.borrow().clone()
        }
    }
    impl Transport for Fake {
        fn get(&self, url: &Url, _accept: &str) -> Result<Response, String> {
            self.requested.borrow_mut().push(url.to_string());
            let (status, location, body) = self
                .replies
                .borrow_mut()
                .pop_front()
                .expect("unexpected request")?;
            Ok(Response {
                status,
                location: location.map(str::to_owned),
                body: Box::new(Cursor::new(body)),
            })
        }
    }
    const ASSET: &str = "https://github.com/salan70/docbridge/releases/download/v2.0.0/x";

    #[test]
    fn follows_allowlisted_redirects_and_returns_body() {
        let fake = Fake::default()
            .reply(
                302,
                Some("https://objects.githubusercontent.com/a?sig=1"),
                b"",
            )
            .reply(307, Some("/b"), b"")
            .reply(200, None, b"payload");
        assert_eq!(get_limited(&fake, ASSET, 100).unwrap(), b"payload");
        assert_eq!(
            fake.requested(),
            [
                ASSET,
                "https://objects.githubusercontent.com/a?sig=1",
                "https://objects.githubusercontent.com/b"
            ]
        );
    }

    #[test]
    fn redirect_to_untrusted_host_or_http_is_rejected_before_request() {
        for target in [
            "https://evil.example/x",
            "http://objects.githubusercontent.com/x",
            "https://user@github.com/x",
            "https://github.com:8443/x",
            "https://github.com.evil.example/x",
        ] {
            let fake = Fake::default().reply(302, Some(target), b"");
            let err = get_limited(&fake, ASSET, 100).unwrap_err();
            assert!(err.contains("untrusted"), "{target}: {err}");
            assert_eq!(fake.requested(), [ASSET], "{target} must not be requested");
        }
        let fake = Fake::default();
        assert!(get_limited(&fake, "http://github.com/x", 100).is_err());
        assert!(fake.requested().is_empty());
    }

    #[test]
    fn redirect_loops_and_missing_location_fail() {
        let mut fake = Fake::default();
        for _ in 0..=MAX_REDIRECTS {
            fake = fake.reply(301, Some(ASSET), b"");
        }
        assert!(get_limited(&fake, ASSET, 100)
            .unwrap_err()
            .contains("too many"));
        let fake = Fake::default().reply(302, None, b"");
        assert!(get_limited(&fake, ASSET, 100)
            .unwrap_err()
            .contains("Location"));
    }

    #[test]
    fn non_200_and_transport_errors_fail() {
        for status in [204, 304, 404, 500] {
            let fake = Fake::default().reply(status, None, b"body");
            let err = get_limited(&fake, ASSET, 100).unwrap_err();
            assert!(err.contains(&status.to_string()), "{err}");
        }
        let fake = Fake::default().fail("release network failure: timed out");
        assert!(get_limited(&fake, ASSET, 100)
            .unwrap_err()
            .contains("timed out"));
    }

    #[test]
    fn size_cap_is_enforced() {
        let fake = Fake::default().reply(200, None, &[0; 10]);
        assert_eq!(get_limited(&fake, ASSET, 10).unwrap().len(), 10);
        let fake = Fake::default().reply(200, None, &[0; 11]);
        assert!(get_limited(&fake, ASSET, 10)
            .unwrap_err()
            .contains("size limit"));
        assert_eq!(size_limit("docbridge-manifest.sig"), 64);
        assert_eq!(size_limit("docbridge-manifest.json"), 1024 * 1024);
    }

    #[test]
    fn latest_rejects_foreign_asset_urls_and_fetch_uses_official_url() {
        let foreign = br#"{"tag_name":"v2.0.0","prerelease":false,"draft":false,
            "assets":[{"name":"x","browser_download_url":"https://evil.example/x"}]}"#;
        let client = OfficialClient {
            transport: Box::new(Fake::default().reply(200, None, foreign)),
        };
        assert!(client.latest().is_err());

        let good = format!(
            r#"{{"tag_name":"v2.0.0","prerelease":false,"draft":false,
            "assets":[{{"name":"x","browser_download_url":"{ASSET}"}}]}}"#
        );
        let client = OfficialClient {
            transport: Box::new(
                Fake::default()
                    .reply(200, None, good.as_bytes())
                    .reply(200, None, b"bin"),
            ),
        };
        let release = client.latest().unwrap();
        assert_eq!(release.tag, "v2.0.0");
        assert_eq!(client.fetch(&release, "x").unwrap(), b"bin");
        assert!(client.fetch(&release, "missing").is_err());
    }
}
