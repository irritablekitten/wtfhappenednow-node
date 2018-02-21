const damerau = require('damerau-levenshtein');
const isomorphicFetch = require('isomorphic-fetch');
const moment = require('moment');
const schedule = require('node-schedule');
const admin = require("firebase-admin");
const serviceAccount = require("./keys/https://some-server-credentials.json");
const keys = require('./keys/keys');
const token = keys.key;
const filters = ['to', 'for', 'the', 'in', 'a', 'and', 'to', 'of', 'but', 'from', 'at', 'when', ',', '', '|', 'is', 'are', 'an', 'will', 'be', '-', '\\', 'by', 'on', 'as', 'with', 'it'];
const regexFilter = /(^&#039\W|&#039$\W)/;
let sourceArray = [];
let titleArray = [];
let compareArray = [];
let countSources = [];

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://some-server.firebaseio.com"
});
var db = admin.database();


//gets all news sources by id
let scrape = async () => {
    let res = await fetch(
      `https://newsapi.org/v1/sources?language=en`);
    return await res.json();  
  }

//obtains top articles per source id
let addTitles = async (obj) => {
    let res = await fetch(
        `https://newsapi.org/v2/top-headlines?sources=${obj}&apiKey=${token}`)
    return await res.json(); 
}

const sourceMap = () => {
    let newArray = [];
    scrape().then((res) =>  {
        if (res.sources !== undefined) {
            res.sources.map(function (obj) {             
                newArray.push(obj);              
            });    
        }
    }).catch(err => console.error(err))
    return newArray;
}

const titleMap = (titles) => {
    let newArray = [];
    titles.map(function (obj) {
        addTitles(obj.id).then((res) => {
            if (res.articles !== undefined) {
                res.articles.map(function (objTwo) {
                    let article = {
                        id: obj.id,
                        title: objTwo.title,
                        url: objTwo.url
                    };
                    newArray.push(article);
                }); 
            } 
        }).catch(err => console.error(err)) 
    });
    return newArray;
}

//https://stackoverflow.com/questions/17313268/idiomatically-find-the-number-of-occurrences-a-given-value-has-in-an-array
class Counter extends Map {
    constructor(iter, key=null) {
        super();
        this.key = key || (x => x);
        for (let x of iter) {
            this.add(x);
        }
    }
    add(x) {
      x = this.key(x);
      this.set(x, (this.get(x) || 0) + 1);
    }
  }

//finds matches between titles by comparing one title in titleArray from the compareFunction loop to every title within the same array, while logging high-scoring results and ignoring exact matches
const damerauLevenshteinFunction = (i) => {
    let copy = titleArray;
    copy.map(function (obj) {
        let test = damerau(obj.title, i.title);

        let comparison = {
            score: test.similarity,
            first: obj.title,
            second: i.title,
            source: i.id
        };
        
        if (comparison.score > 0.4 && comparison.score < 1 && comparison.first !== '' && comparison.second !== '') {
            compareArray.push(comparison);
        } 
    });       
}

//provides the top level loop for finding matches in titleArray with the damerau-levenshtein algorith
const compareFunction = () => {
    compareArray = [];
    let copy = titleArray;
    copy.map(function (i) {
        damerauLevenshteinFunction(i);
    });
}

//takes results pushed to compareArray and splits each title into individual words to find commonality
const splitFunction = (splitThis) => {
    let copy = splitThis;
    let newArray = [];
    let countArray = [];
    copy.map(function (obj) {
        if (obj !== undefined) {
            let post = obj.first.split(' ');
            newArray.push(post);
            countArray.push(obj.source);
        }
     });
     countSources = countArray;
     return newArray;
}

//splitter for the simple filter
/*
const splitSimple = (splitThis) => {
    let newArray = []
    for (let entry in splitThis) {
        if (splitThis[entry] !== undefined) {
            let newString = splitThis[entry].toString().split('');
            newArray.push(newString);
        }
    }
    return newArray;
}
*/

//returns a new array with old arrays split apart
const arrayFixer = (array) => {
    let newArray = [];
    for (let i in array) {
        for (let j in array[i]) {
            if (array[i][j] !== undefined && regexFilter.test(array[i][j]) !== true) {
                newArray.push(array[i][j].toString().toLowerCase());
            }                    
        }        
    }
    return newArray;
}

//for filtering out common words being counted
const arrayFilter = (results) => {
    results = results.filter(item => !filters.includes(item))
    return results; 
}

//pushes results to firebase DB
const sendToDB = (wordscounted, sourcescounted, ref) => {
    let dateTime = moment().format('LLL');
    let postsRef = ref.child("results");
    postsRef.push({
        wordcount: wordscounted,
        sourcecount: sourcescounted,
        date: admin.database.ServerValue.TIMESTAMP,
        fulldate: dateTime
      });
}

const main = () => {
    //scheduled to grab sources and top articles from each source at the 58 and 59 minutes every hour or 51 and 52 for pi3 (it's slow)
    let getSources = schedule.scheduleJob('51 * * * *', function(){
        sourceArray = sourceMap();
    });
    let getArticles = schedule.scheduleJob('52 * * * *', function(){
        titleArray = titleMap(sourceArray);
    });

    //scheduled to process data at 59 minutes of every hour or 53 for pi3
    let complexCompare = schedule.scheduleJob('53 * * * *', function(){
        compareFunction();
        let ref = db.ref("/newsdata/1d3V3Yd3CRen8aqYTrXx/");
        let splitArray = splitFunction(compareArray);
        let results = arrayFixer(splitArray);
        let countArray = arrayFilter(results);     
        let counter = new Counter(countArray);
        delete counter.key;
        let sortWords = Array.from(counter);
        sortWords.sort(function(a, b) {
            return b[1] - a[1];
        });

        let printSources = new Counter(countSources);
        delete printSources.key;
        let sortSources = Array.from(printSources);
        sortSources.sort(function(a, b) {
            return b[1] - a[1];
        });
        
        sendToDB(sortWords, sortSources, ref);
        console.log("Complex sent to DB. ", moment().format('LLL'));
    });
    //simple filter WIP
    /*
    let simpleCompare = schedule.scheduleJob('01 * * * *', function(){
        let ref = db.ref("/newsdata/zxl36W7TxudNhEsduy6a/");
        let splitArray = splitSimple(titleArray);
        let results = arrayFixer(splitArray);
        let countArray = arrayFilter(results);     
        let counter = new Counter(countArray);
        delete counter.key;
        let sortWords = Array.from(counter);
        sortWords.sort(function(a, b) {
            return b[1] - a[1];
        });

        let printSources = new Counter(sourceArray);
        delete printSources.key;
        let sortSources = Array.from(printSources);
        sortSources.sort(function(a, b) {
            return b[1] - a[1];
        });
        
        sendToDB(sortWords, sortSources, ref);
        console.log("Simple sent to DB. ", moment().format('LLL'));
    });
    */
}

main();