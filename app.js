//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    jwt = require( 'jsonwebtoken' ),
    OAuth = require( 'oauth' ),
    request = require( 'request' ),
    session = require( 'express-session' ),
    Twitter = require( 'twitter' ),
    //watson_pi_v3 = require( 'watson-developer-cloud/personality-insights/v3' ),
    watson_pi_v3 = require( 'ibm-watson/personality-insights/v3' ),
    settings = require( './settings' ),
    app = express();
var { IamAuthenticator } = require( 'ibm-watson/auth' );
var settings = require( './settings' );
/*
var pi = new watson_pi_v3({
  username: settings.pi_username,
  password: settings.pi_password,
  version_date: '2016-10-20'
});
*/
var pi = new watson_pi_v3({
  authenticator: new IamAuthenticator({
    apikey: settings.watson_pi_apikey
  }),
  url: settings.watson_pi_url,
  version: '2017-10-13'
});

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

app.use( session({
  secret: settings.superSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,           //. https で使う場合は true
    maxage: 1000 * 60 * 60   //. 60min
  }
}) );


//. Twitter API
var oa = new OAuth.OAuth(
  'https://api.twitter.com/oauth/request_token',
  'https://api.twitter.com/oauth/access_token',
  settings.twitter_consumer_key,
  settings.twitter_consumer_secret,
  '1.0A',
  null,
  'HMAC-SHA1'
);

app.get( '/twitter', function( req, res ){
  oa.getOAuthRequestToken( function( err, oauth_token, oauth_token_secret, results ){
    if( err ){
      console.log( err );
      res.redirect( '/' );
    }else{
      req.session.oauth = {};
      req.session.oauth.token = oauth_token;
      req.session.oauth.token_secret = oauth_token_secret;
      res.redirect( 'https://twitter.com/oauth/authenticate?oauth_token=' + oauth_token );
    }
  });
});

app.get( '/twitter/callback', function( req, res ){
  if( req.session.oauth ){
    req.session.oauth.verifier = req.query.oauth_verifier;
    var oauth = req.session.oauth;
    oa.getOAuthAccessToken( oauth.token, oauth.token_secret, oauth.verifier, function( err, oauth_access_token, oauth_access_token_secret, results ){
      if( err ){
        console.log( err );
        res.redirect( '/' );
      }else{
        req.session.oauth.provider = 'twitter';
        req.session.oauth.user_id = results.user_id;
        req.session.oauth.screen_name = results.screen_name;
        req.session.oauth.access_token = oauth_access_token;
        req.session.oauth.access_token_secret = oauth_access_token_secret;
        //console.log( req.session.oauth );

        var token = jwt.sign( req.session.oauth, settings.superSecret, { expiresIn: '25h' } );
        req.session.token = token;

        var client = new Twitter({
          consumer_key: settings.twitter_consumer_key,
          consumer_secret: settings.twitter_consumer_secret,
          access_token_key: oauth_access_token,
          access_token_secret: oauth_access_token_secret
        });
        var params = { count: 200 };
        client.get( 'statuses/user_timeline', params, function( err, tweets, response ){
          //console.log( err );
          if( err ){
            res.redirect( '/' );
          }else{
            //console.log( tweets );
            var texts = '';
            tweets.forEach( function( tweet ){
              texts += tweet.text;
            });

            var pi_params = {
              content: texts,
              contentType: 'text/plain',
              consumption_preferences: true,
              raw_scores: true,
              headers: {
                'accept-language': 'ja',
                'content-language': 'ja',
                'accept': 'application/json'
              }
            };
            pi.profile( pi_params, function( error, response ){
              var result = {};
              if( error ){
                result = { status: false, error: error };
              }else{
                result = { status: true, result: response };
                req.session.result = response.result;

                //. { word_count: 9100, personality: [], needs[], values[], .. }
                //console.log( JSON.stringify( response.result, null, 2 ) ); //. result.result.result
              }
              //console.log( result ); //. result.result.result

              res.redirect( '/' );
              //res.write( JSON.stringify( result ) );
              //res.end();
            });
          }
        });
      }
    });
  }else{
    res.redirect( '/' );
  }
});

app.post( '/logout', function( req, res ){
  req.session.token = null;
  //res.redirect( '/' );
  res.write( JSON.stringify( { status: true }, 2, null ) );
  res.end();
});


app.get( '/', function( req, res ){
  var user = null;
  var result = null;
  if( req.session && req.session.result ){
    result = req.session.result;
  }
  if( req.session && req.session.token ){
    var token = req.session.token;
    jwt.verify( token, settings.superSecret, function( err, user0 ){
      if( user0 ){
        user = user0;
      }
      res.render( 'index', { user: user, result: result } );
    });
  }else{
    res.render( 'index', { user: user, result: result } );
  }
});

app.post( '/postpi', function( req, res ){
  var text = req.body.text;

  var pi_params = {
    text: text,
    consumption_preferences: true,
    raw_scores: true,
    headers: {
      'accept-language': 'ja',
      'content-language': 'ja',
      'accept': 'application/json'
    }
  };
  pi.profile( pi_params, function( error, response ){
    var result = {};
    if( error ){
      result = { status: false, error: error };
    }else{
      result = { status: true, result: response };
    }

    res.write( JSON.stringify( result ) );
    res.end();
  });
});

app.get( '/profileimage', function( req, res ){
  var screen_name = req.query.screen_name;
  if( screen_name ){
    var option = {
      url: 'https://twitter.com/' + screen_name + '/profile_image?size=original',
      method: 'GET'
    };
    request( option, ( err0, res0, body0 ) => {
      if( err0 ){
        return res.status( 403 ).send( { status: false, error: err0 } );
      }else{
        res.redirect( 'https://pbs.twimg.com' + res0.request.path );
      }
    });
  }else{
    return res.status( 403 ).send( { status: false, error: 'No screen_name provided.' } );
  }
});

var port = process.env.port || 8080;
app.listen( port );
console.log( "server stating on " + port + " ..." );
