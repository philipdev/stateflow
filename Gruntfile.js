/*jslint node: true, stupid: true */
'use strict';

var fs = require('fs');
var path = require('path');

function generateGraphFiles(outpath) {
    var result = {}, files = fs.readdirSync(outpath);
    files.forEach(function (file) {
        var base;
        if (path.extname(file) === '.dot') {
            base = path.basename(file, '.dot');
            result[outpath + '/' + base + '.png'] = outpath + '/' + file;
        }
    });
    return result;
}

function generateDot(input, output) {
    var content = '', source = require('./' + input);
    content = 'digraph sample {\n';
    Object.keys(source).forEach(function (stateName) {
        var state = source[stateName];
        if (state.on) {
            Object.keys(state.on).forEach(function (event) {
                content += '"' + stateName + '"' + ' -> "' + state.on[event] + '" [label="' + event + '"];\n';
            });
        }
    });
    content += '}\n';
    fs.writeFileSync(output, content);
}

module.exports = function (grunt) {

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jsdoc');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-graphviz');
    grunt.loadNpmTasks("grunt-jsdoc-to-markdown");
    
    grunt.initConfig({
        jshint: {
            all: ['lib/*.js', 'test/*.js', 'Gruntfile.js']
        },
        jsdoc : {
            js : {
                src: ['lib/*.js'],
                dest: 'out'
            }
        },
        jsdoc2md: {
            oneOutputFile: {
                src: "lib/*.js",
                dest: "README.md"
            }
        },    
        mochaTest: {
            test: {
                options: {
                    reporter: 'spec',
                    captureFile: 'out/results.txt', // Optionally capture the reporter output to a file
                    quiet: false, // Optionally suppress output to standard out (defaults to false)
                    clearRequireCache: false // Optionally clear the require cache before running tests (defaults to false)
                },
                src: ['test/**.js']
            }
        },
        watch: {
            js: {
                files: ['lib/*.js', 'test/*.js', 'Gruntfile.js', 'test/flows/*.json'],
                tasks: ['mochaTest', 'jshint', 'jsdoc']
            }
        },
        graphviz: {
            flows: {
                files: {} // overwritten, because these files will be generated!
            }
        }
    });

    grunt.registerTask('default', ['jshint', 'mochaTest', 'jsdoc']);
    grunt.registerTask('dot', function () { // still need to include then into the documentation
        var files = fs.readdirSync('test/flows');
        files.forEach(function (file) {
            if (path.extname(file) === '.json') {
                generateDot('test/flows/' + file, 'out/flows/' + path.basename(file, '.json') + '.dot');
            }
        });
        grunt.config.set('graphviz.flow.files', generateGraphFiles('out/flows'));
    });
    grunt.registerTask('graph', ['dot', 'graphviz']);
};