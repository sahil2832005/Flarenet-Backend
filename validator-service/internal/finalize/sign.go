package finalize

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// signManifest returns a hex-encoded HMAC-SHA256 signature of the raw manifest
// bytes using the provided secret key.
//
// The Node.js backend can verify this signature to confirm the manifest was
// produced by the trusted validator service and has not been tampered with:
//
//	const sig = crypto.createHmac('sha256', secret).update(manifestJSON).digest('hex')
//	if (sig !== storedSignature) throw new Error('manifest tampered')
func signManifest(raw []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	return hex.EncodeToString(mac.Sum(nil))
}
