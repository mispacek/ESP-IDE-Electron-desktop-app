# this is to run text editor locally, for development of editor itself

from flask import Flask, request, Response, jsonify, send_from_directory
import shutil
import os
import re
import json
import binascii


# set the project root directory as the static folder, you can set others.
app = Flask(__name__, static_url_path='')
app._static_folder = ''


@app.route('/')
def root():
    return app.send_static_file('index.html')

@app.route('/<filename>.gz')
def gzipped_static(filename):
    with open(filename + '.gz', 'rb') as f:
        r = Response(f.read())
        r.headers['Content-Encoding'] = 'gzip'
        r.headers['Content-Type'] = 'application/javascript'
    return r


if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=80)



