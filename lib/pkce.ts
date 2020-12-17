/*!
 * Copyright (c) 2019-present, Okta, Inc. and/or its affiliates. All rights reserved.
 * The Okta software accompanied by this notice is provided pursuant to the Apache License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and limitations under the License.
 *
 */
/* global crypto */
 /* eslint-disable complexity, max-statements */
import AuthSdkError from './errors/AuthSdkError';
import http from './http';
import { warn, stringToBase64Url, removeNils, toQueryString } from './util';
import { TokenParams, CustomUrls, PKCEMeta, OAuthResponse, OAuthParams } from './types';
import { MIN_VERIFIER_LENGTH, MAX_VERIFIER_LENGTH, DEFAULT_CODE_CHALLENGE_METHOD } from './constants';

function dec2hex (dec) {
  return ('0' + dec.toString(16)).substr(-2);
}

function getRandomString(length) {
  var a = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(a);
  var str = Array.from(a, dec2hex).join('');
  return str.slice(0, length);
}

function generateVerifier(prefix?: string): string {
  var verifier = prefix || '';
  if (verifier.length < MIN_VERIFIER_LENGTH) {
    verifier = verifier + getRandomString(MIN_VERIFIER_LENGTH - verifier.length);
  }
  return encodeURIComponent(verifier).slice(0, MAX_VERIFIER_LENGTH);
}

function getStorage(sdk, options?) {
  options = Object.assign({}, sdk.options.cookies, options);
  return sdk.options.storageUtil.getPKCEStorage(options);
}

function saveMeta(sdk, meta: PKCEMeta) {
  // There must be only one PKCE flow executing at a time.
  // Before saving meta, check to see if a codeVerfier is already stored.
  var storage = getStorage(sdk, { preferLocalStorage: true });
  var obj = storage.getStorage();
  if (obj.codeVerifier) {
    // eslint-disable-next-line max-len
    warn('saveMeta: PKCE codeVerifier exists in localStorage. This may indicate an auth flow is already in progress.');
  }

  storage = getStorage(sdk);
  obj = storage.getStorage();
  if (obj.codeVerifier) {
    // eslint-disable-next-line max-len
    warn('saveMeta: PKCE codeVerifier exists in sessionStorage. This may indicate an auth flow is already in progress.');
  }

  // clear all PKCE meta storage before saving.
  clearMeta(sdk);

  storage.setStorage(meta);
}

function loadMeta(sdk): PKCEMeta {
  // Try reading from localStorage first.
  // This is for compatibility with older versions of the signin widget. OKTA-304806
  var storage = getStorage(sdk, { preferLocalStorage: true });
  var obj = storage.getStorage();
  // Verify the Meta
  if (!obj.codeVerifier) {
    // If meta is not valid, read from sessionStorage. This is expected for current versions of the SDK.
    storage = getStorage(sdk, { preferLocalStorage: false });
    obj = storage.getStorage();
    if (!obj.codeVerifier) {
      // If meta is not valid, throw an exception to avoid misleading server-side error
      // The most likely cause of this error is trying to handle a callback twice
      // eslint-disable-next-line max-len
      throw new AuthSdkError('Could not load PKCE codeVerifier from storage. This may indicate the auth flow has already completed or multiple auth flows are executing concurrently.', null);
    }
  }
  return obj;
}

function clearMeta(sdk) {
  // clear sessionStorage (current version)
  var storage = getStorage(sdk);
  storage.clearStorage();
  // clear localStorage (previous versions, signin widget)
  storage = getStorage(sdk, { preferLocalStorage: true });
  storage.clearStorage();
}

function computeChallenge(str: string): PromiseLike<any> {  
  var buffer = new TextEncoder().encode(str);
  return crypto.subtle.digest('SHA-256', buffer).then(function(arrayBuffer) {
    var hash = String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    var b64u = stringToBase64Url(hash); // url-safe base64 variant
    return b64u;
  });
}


function validateOptions(options: TokenParams) {
  // Quick validation
  if (!options.clientId) {
    throw new AuthSdkError('A clientId must be specified in the OktaAuth constructor to get a token');
  }

  if (!options.redirectUri) {
    throw new AuthSdkError('The redirectUri passed to /authorize must also be passed to /token');
  }

  if (!options.authorizationCode && !options.interactionCode) {
    throw new AuthSdkError('An authorization code (returned from /authorize) must be passed to /token');
  }

  if (!options.codeVerifier) {
    throw new AuthSdkError('The "codeVerifier" (generated and saved by your app) must be passed to /token');
  }
}

function getPostData(options: TokenParams): string {
  // Convert Token params to OAuth params, sent to the /token endpoint
  var params: OAuthParams = removeNils({
    'client_id': options.clientId,
    'redirect_uri': options.redirectUri,
    'grant_type': options.interactionCode ? 'interaction_code' : 'authorization_code',
    'code_verifier': options.codeVerifier
  });

  if (options.interactionCode) {
    params['interaction_code'] = options.interactionCode;
  } else if (options.authorizationCode) {
    params.code = options.authorizationCode;
  }

  // Encode as URL string
  return toQueryString(params).slice(1);
}

// exchange authorization code for an access token
function exchangeCodeForTokens(sdk, options: TokenParams, urls: CustomUrls): Promise<OAuthResponse> {
  validateOptions(options);
  var data = getPostData(options);

  return http.httpRequest(sdk, {
    url: urls.tokenUrl,
    method: 'POST',
    args: data,
    withCredentials: false,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

export default {
  DEFAULT_CODE_CHALLENGE_METHOD,
  generateVerifier,
  clearMeta,
  saveMeta,
  loadMeta,
  computeChallenge,
  exchangeCodeForTokens
};
