import Foundation
import Security

// A unique, synthetic item checks the same keychain mode as the Flutter plugin
// without reading or changing any application credentials.
let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrAccount: "airqr-release-smoke-\(UUID().uuidString)",
    kSecAttrService: "airqr-release-verification",
    kSecAttrAccessible: kSecAttrAccessibleWhenUnlocked,
    kSecAttrSynchronizable: false,
    kSecUseDataProtectionKeychain: false,
]
let expected = Data("synthetic release verification".utf8)
func verify(_ status: OSStatus, _ operation: String) {
    guard status == errSecSuccess else {
        print("Keychain \(operation) failed: \(status)")
        exit(1)
    }
}
var write = query
write[kSecValueData] = expected
verify(SecItemAdd(write as CFDictionary, nil), "write")
var read = query
read[kSecReturnData] = true
var result: CFTypeRef?
let readStatus = SecItemCopyMatching(read as CFDictionary, &result)
let deleteStatus = SecItemDelete(query as CFDictionary)
verify(readStatus, "read")
verify(deleteStatus, "delete")
guard result as? Data == expected else {
    print("Keychain round-trip mismatch")
    exit(1)
}
print("Ad-hoc signed sandboxed keychain round-trip passed")
