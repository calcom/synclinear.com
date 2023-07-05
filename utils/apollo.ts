import {
    ApolloClient,
    InMemoryCache,
    gql,
    ApolloQueryResult
} from "@apollo/client";
import { LINEAR } from "./constants";

/**
 * Initialize Apollo instance for Linear with cache
 */
const apolloLinear = new ApolloClient({
    uri: LINEAR.GRAPHQL_ENDPOINT,
    cache: new InMemoryCache(),
    defaultOptions: {
        query: {
            fetchPolicy: "no-cache"
        }
    }
});

/**
 * Make a request to the Linear GraphQL API
 * @param {string} query the GraphQL query eg. `query YourQuery { teams { nodes { name } } }`
 * @param {string} token to authenticate the request
 * @param variables to pass to the query eg. `query WithVars($first: Number) { issues(first: $first) { nodes { name } } }`
 * @returns {Promise<ApolloQueryResult<any>>} result
 */
export async function linearQuery(
    query: string,
    token: string,
    variables = {}
): Promise<ApolloQueryResult<any>> {
    // Is this a query or mutation? This allows us to use a single method.
    const operation = query.split(" ")[0];
    if (!["query", "mutation"].includes(operation)) return;

    const QUERY = gql`
        ${query}
    `;

    // Make the request
    const payload = await apolloLinear[
        operation === "mutation" ? "mutate" : operation
    ]({
        [operation]: QUERY,
        variables,
        context: {
            headers: {
                authorization: `${
                    !token.startsWith("Bearer") ? "Bearer " : ""
                }${token}`
            }
        }
    });

    if (payload.error) throw new Error(payload.error);
    if (payload.errors)
        throw new Error(payload.errors[0].extensions.userPresentableMessage);
    if (!payload.data) throw new Error("No data returned from query");

    return payload;
}

