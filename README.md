# Batch geocoder

This is a batch geocoder adapted from [Mapzen's Pelias scripts-batch-search](https://github.com/pelias/scripts-batch-search)
and generalized for use with the Elasticsearch schema that can be set up from the
[Consumer Financial Protection Bureau's Grasshopper geocoder](https://github.com/cfpb/grasshopper).

This is mainly intended for doing bulk geocoding extremely quickly on semi-structured
addresses, ideally parsed by the [usaddress](https://github.com/datamade/usaddress)
library or something similar.

This should ideally work both for matching against master address databases like in
Grasshopper as well as interpolating address ranges from Census TIGER ADDRFEAT files.

Currently this is an attempt to geocode millions of addresses for the [national-voter-file](https://github.com/national-voter-file/national-voter-file.git)
project. 

## What you'll need

This geocoder requires node.js and npm (which is included in node installs) to run. It’s available for installation here: https://nodejs.org/en/

For the time being, this geocoder only uses CSV files for input and output.

**Note:** This is currently very much a work in progress

## Run command
```bash
npm run start -- ./file/input.csv ./file/output.csv census census
```

Once running, the script will update to let you know its progress through the file. Once finished, you should see your output CSV file contain all the data from the input CSV, plus additional columns representing the results. All results columns will be prefixed with res_ to avoid conflicts. You can see an example of expected output [here](test/expectedOutput.csv)
