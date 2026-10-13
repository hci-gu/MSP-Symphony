package se.havochvatten.symphony.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.TreeSet;

public final class InputFingerprint {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static JsonNode canonical(JsonNode value) {
        if (value.isNumber()) return DecimalNode.valueOf(value.decimalValue().stripTrailingZeros());
        if (value.isObject()) {
            ObjectNode result = JSON.createObjectNode();
            TreeSet<String> keys = new TreeSet<>();
            value.fieldNames().forEachRemaining(keys::add);
            keys.forEach(key -> result.set(key, canonical(value.get(key))));
            return result;
        }
        if (value.isArray()) {
            ArrayNode result = JSON.createArrayNode();
            value.forEach(item -> result.add(canonical(item)));
            return result;
        }
        return value;
    }
    public static String hash(JsonNode value) throws IOException {
        return HexFormat.of().formatHex(digest().digest(JSON.writeValueAsBytes(canonical(value))));
    }
    public static String hash(Path path) throws IOException {
        MessageDigest hash = digest();
        try (var input = Files.newInputStream(path)) {
            byte[] bytes = new byte[65536];
            int count;
            while ((count = input.read(bytes)) != -1) hash.update(bytes, 0, count);
        }
        return HexFormat.of().formatHex(hash.digest());
    }
    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private InputFingerprint() {}
}
