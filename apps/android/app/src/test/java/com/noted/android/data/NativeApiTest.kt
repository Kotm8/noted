package com.noted.android.data

import kotlinx.coroutines.runBlocking
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeApiTest {
    @Test fun cookiesAndCsrfStayOnTheirOwnServerAndRespectPaths() {
        val origin = "https://notes.example.com".toHttpUrl()
        val session = Cookie.parse(origin, "noted_session=private; Path=/api; Secure; Max-Age=3600")!!
        val csrf = Cookie.parse(origin, "noted_csrf=verify; Path=/; Secure; Max-Age=3600")!!
        val jar = SessionCookies(origin, listOf(session, csrf)) {}
        assertEquals(2, jar.loadForRequest("https://notes.example.com/api/v1/home/activity".toHttpUrl()).size)
        assertEquals(listOf(csrf), jar.loadForRequest("https://notes.example.com/image.png".toHttpUrl()))
        assertTrue(jar.loadForRequest("https://another.example.com/api/v1/home/activity".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("https://notes.example.com:444/api/v1/home/activity".toHttpUrl()).isEmpty())
        assertTrue(jar.loadForRequest("http://notes.example.com/api/v1/home/activity".toHttpUrl()).isEmpty())
        assertEquals("verify", jar.csrf())
    }

    @Test fun nativeSignInReusesServerSessionCookiesAndSendsCsrfOnWrites() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val api = NativeApi(origin)
            server.enqueue(MockResponse().addHeader("Set-Cookie", "noted_session=private; Path=/api; Max-Age=3600")
                .addHeader("Set-Cookie", "noted_csrf=verify; Path=/; Max-Age=3600").setBody("{\"id\":\"owner\",\"username\":\"ilya\"}"))
            api.request("/auth/login", "POST", json("username" to "ilya", "password" to "only-a-fixture-password"))
            assertEquals("/api/v1/auth/login", server.takeRequest().path)
            server.enqueue(MockResponse().setBody("{\"id\":\"message\"}"))
            api.request("/channels/channel/messages", "POST", json("content" to "Hello"))
            val sent = server.takeRequest()
            assertEquals(origin, sent.getHeader("Origin"))
            assertEquals("verify", sent.getHeader("X-CSRF-Token"))
            assertTrue(sent.getHeader("Cookie")!!.contains("noted_session=private"))
        }
    }

    @Test fun redirectsAreNotFollowedAndOtherOriginsCannotReceiveRequests() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val api = NativeApi(server.url("/").toString().trimEnd('/'))
            server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "https://another.example.com/private"))
            try { api.request("/home/activity"); fail("The redirect must not be followed.") }
            catch (error: ApiException) { assertEquals(302, error.status) }
            assertFalse(api.sameOrigin("https://another.example.com/api/v1/home/activity"))
            assertFalse(api.sameOrigin("https://user:password@another.example.com/"))
        }
    }

    @Test fun revokedSessionInvokesSignOutButTemporaryFailuresDoNot() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            var revoked = 0
            val api = NativeApi(server.url("/").toString().trimEnd('/'), unauthorized = { revoked++ })
            server.enqueue(MockResponse().setResponseCode(503).setBody("{\"detail\":\"Restarting\"}"))
            runCatching { api.request("/auth/session") }
            assertEquals(0, revoked)
            server.enqueue(MockResponse().setResponseCode(401).setBody("{\"detail\":\"Expired\"}"))
            runCatching { api.request("/auth/session") }
            assertEquals(1, revoked)
        }
    }

    @Test fun storedSessionRoundTripsWithoutExtendingItsExpiry() {
        val url = "https://notes.example.com".toHttpUrl()
        val cookie = Cookie.parse(url, "noted_session=private; Path=/api; Secure; Max-Age=3600")!!
        val saved = NativeSession(url.toString().trimEnd('/'), "owner", "ilya", listOf(cookie))
        val restored = NativeSession.decode(saved.encode())
        assertTrue(restored.valid)
        assertEquals(saved.partition, restored.partition)
        assertTrue(kotlin.math.abs(cookie.expiresAt - restored.cookies.single().expiresAt) < 1000)
        assertNotEquals(saved.partition, saved.copy(origin = "https://other.example.com").partition)
    }
}
