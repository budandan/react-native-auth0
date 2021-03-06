import Agent from './agent';
import {NativeModules, Platform} from 'react-native';

import url from 'url';
import AuthError from '../auth/authError';
import verifyToken from '../jwt';

const {A0Auth0} = NativeModules;

const callbackUri = (domain, redirectUri) => {
  if (redirectUri) {
    return redirectUri;
  }

  const bundleIdentifier = A0Auth0.bundleIdentifier;
  return `${bundleIdentifier.toLowerCase()}://${domain}/${
    Platform.OS
  }/${bundleIdentifier}/callback`;
};

/**
 * Helper to perform Auth against Auth0 hosted login page
 *
 * It will use `/authorize` endpoint of the Authorization Server (AS)
 * with Code Grant and Proof Key for Challenge Exchange (PKCE).
 *
 * @export
 * @class WebAuth
 * @see https://auth0.com/docs/api-auth/grant/authorization-code-pkce
 */
export default class WebAuth {
  constructor(auth) {
    this.client = auth;
    const {clientId, domain} = auth;
    this.domain = domain;
    this.clientId = clientId;
    this.agent = new Agent();
  }

  /**
   * Starts the AuthN/AuthZ transaction against the AS in the in-app browser.
   *
   * In iOS it will use `SFSafariViewController` and in Android Chrome Custom Tabs.
   *
   * To learn more about how to customize the authorize call, check the Universal Login Page
   * article at https://auth0.com/docs/hosted-pages/login
   *
   * @param {Object} parameters parameters to send on the AuthN/AuthZ request.
   * @param {String} [parameters.state] random string to prevent CSRF attacks and used to discard unexepcted results. By default its a cryptographically secure random.
   * @param {String} [parameters.nonce] random string to prevent replay attacks of id_tokens.
   * @param {String} [parameters.audience] identifier of Resource Server (RS) to be included as audience (aud claim) of the issued access token
   * @param {String} [parameters.scope] scopes requested for the issued tokens. e.g. `openid profile`
   * @param {String} [parameters.connection] The name of the identity provider to use, e.g. "google-oauth2" or "facebook". When not set, it will display Auth0's Universal Login Page.
   * @param {Number} [parameters.max_age] The allowable elapsed time in seconds since the last time the user was authenticated (optional).
   * @param {Object} options options for ID token validation configuration.
   * @param {Number} [options.leeway] The amount of leeway, in seconds, to accommodate potential clock skew when validating an ID token's claims. Defaults to 60 seconds if not specified.
   * @returns {Promise}
   * @see https://auth0.com/docs/api/authentication#authorize-client
   *
   * @memberof WebAuth
   */
  authorize(parameters = {}, options = {}) {
    const {clientId, domain, client, agent, redirectUri} = this;
    return agent.newTransaction().then(({state, verifier, ...defaults}) => {
      const redirectToUri = redirectUri || callbackUri(domain);
      const expectedState = parameters.state || state;
      let query = {
        ...defaults,
        clientId,
        responseType: 'code',
        redirectUri: redirectToUri,
        state: expectedState,
        ...parameters,
      };
      const authorizeUrl = this.client.authorizeUrl(query);
      return agent.show(authorizeUrl).then(redirectTo => {
        if (!redirectTo || !redirectTo.startsWith(redirectToUri)) {
          throw new AuthError({
            json: {
              error: 'a0.redirect_uri.not_expected',
              error_description: `Expected ${redirectTo} but got ${redirectToUri}`,
            },
            status: 0,
          });
        }
        const query = url.parse(redirectTo, true).query;
        const {code, state: resultState, error} = query;
        if (error) {
          throw new AuthError({json: query, status: 0});
        }
        if (resultState !== expectedState) {
          throw new AuthError({
            json: {
              error: 'a0.state.invalid',
              error_description: 'Invalid state received in redirect url',
            },
            status: 0,
          });
        }

        return client
          .exchange({code, verifier, redirectUri: redirectTo})
          .then(credentials => {
            return verifyToken(credentials.idToken, {
              domain,
              clientId,
              nonce: parameters.nonce,
              maxAge: parameters.max_age,
              scope: parameters.scope,
              leeway: options.leeway,
            }).then(() => Promise.resolve(credentials));
          });
      });
    });
  }

  /**
   *  Removes Auth0 session and optionally remove the Identity Provider session.
   *
   *  In iOS it will use `SFSafariViewController` and in Android Chrome Custom Tabs.
   *
   * @param {Object} parameters parameters to send
   * @param {Bool} [parameters.federated] Optionally remove the IdP session.
   * @returns {Promise}
   * @see https://auth0.com/docs/logout
   *
   * @memberof WebAuth
   */
  clearSession(options = {}) {
    const {client, agent, domain, clientId, redirectUri} = this;
    options.clientId = clientId;
    options.returnTo = callbackUri(domain, redirectUri);
    options.federated = options.federated || false;
    const logoutUrl = client.logoutUrl(options);
    return agent.show(logoutUrl, true);
  }
}
